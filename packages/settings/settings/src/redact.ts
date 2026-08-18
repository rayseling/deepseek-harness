/**
 * Structural secret redaction for settings values. `role('secret')` fields are
 * removed from a value before it crosses a wire boundary; a sidecar records
 * each schema-declared secret position and whether it currently holds a value,
 * so a configuration surface can render a write-only input without ever
 * receiving the secret itself.
 * @module @deepseek-ai/dsh-settings/redact
 */

import type z from '@deepseek-ai/schemastery'

/**
 * Minimal structural view of a live schemastery node. Only the relations the
 * redactor walks are named; everything else on the instance is ignored.
 */
interface SchemaNode {
  type?: string
  meta?: { role?: unknown }
  /** `object` properties, keyed by property name. */
  dict?: Record<string, SchemaNode | undefined>
  /** `dict`/`array` element schema, and `transform`'s source schema. */
  inner?: SchemaNode
  /** `union`/`intersect` branches and `tuple` members. */
  list?: (SchemaNode | undefined)[]
  /** `dict`'s KEY schema: a secret role here makes the key names themselves secret. */
  sKey?: SchemaNode
  /**
   * `lazy`'s deferred child factory. Opaque here because schemastery's own
   * signature returns its `Schema` class; the result is read structurally.
   */
  builder?: unknown
}

/** One schema-declared secret position inside a redacted value. */
export interface RedactedSecret {
  /** Path from the section root to the removed field (concrete dict keys and array indexes included). */
  path: string[]
  /** Whether the field held a value before redaction. */
  set: boolean
}

/** A value with every `role('secret')` field removed, plus the removal record. */
export interface RedactedValue {
  /** Detached copy of the input with secret fields absent. */
  value: unknown
  /**
   * Every reachable secret position: object properties always (even unset, so
   * a form knows the slot exists), dict entries and array items only where the
   * value has them.
   */
  secrets: RedactedSecret[]
  /**
   * Paths where a secret role sits under a container the walker cannot
   * descend (`union`, `intersect`, `transform`, `tuple`). The subtree is
   * withheld from {@link RedactedValue.value} rather than returned verbatim,
   * and each path is reported here so a wire caller can refuse the whole
   * namespace instead of serving a value whose redaction it cannot prove.
   */
  unprovable: string[][]
}

/** Whether a value is a plain data object the walker may recurse into. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Every nested schema a node holds, whichever container names it uses. This is
 * the single place schemastery's nesting relations are enumerated, so a
 * relation added upstream is added once here rather than at each walk site. A
 * `lazy` node's child lives behind `builder` (its `inner` is a stand-in until
 * first validation), so the factory is called here — schemastery documents it
 * as pure construction.
 */
function nested(node: SchemaNode): SchemaNode[] {
  const built = node.type === 'lazy' && typeof node.builder === 'function'
    ? safeBuild(node.builder as () => unknown)
    : []
  const candidates: (SchemaNode | undefined)[] = [
    ...node.type === 'lazy' ? [] : [node.inner],
    ...built,
    ...node.list ?? [],
    ...Object.values(node.dict ?? {}),
    node.sKey,
  ]
  return candidates.filter((candidate): candidate is SchemaNode => candidate !== undefined)
}

/** Call a lazy builder; a throwing builder counts as hiding a secret. */
function safeBuild(builder: () => unknown): (SchemaNode | undefined)[] {
  try {
    const built = builder()
    // A schemastery schema is callable, so it reads as 'function', not 'object'.
    const usable = built !== null && (typeof built === 'object' || typeof built === 'function')
    return [usable ? built as SchemaNode : undefined]
  } catch {
    // A factory that cannot run yields a subtree that cannot be proven
    // secret-free; hidesSecret must treat it as hiding one.
    return [{ meta: { role: 'secret' } }]
  }
}

/**
 * Depth at which the search gives up and fails closed. A recursive schema whose
 * builder returns a fresh tree on every call has no repeated identity to detect,
 * so the visited set alone cannot terminate it; this bound does, and answering
 * "a secret may hide here" keeps that case safe rather than hanging the Host
 * answering a wire request. Far above any real settings schema's nesting.
 */
const MAX_SEARCH_DEPTH = 64

/**
 * Whether a secret role sits anywhere under a node. Used only on nodes the
 * walker does not descend, where a positive answer means the value cannot be
 * proven free of secrets and must be withheld.
 *
 * Cycle-safe: `z.lazy` is how a recursive schema is expressed, so revisiting a
 * node contributes nothing rather than recursing forever. A cycle alone never
 * makes a subtree secret-bearing — only a secret role actually found does.
 * @param node - the node to search under.
 * @param seen - nodes already being searched on this path.
 * @param depth - remaining descent before failing closed.
 * @returns true when a secret role is reachable, or the search could not finish.
 */
function hidesSecret(node: SchemaNode, seen: Set<SchemaNode> = new Set(), depth = MAX_SEARCH_DEPTH): boolean {
  if (node.meta?.role === 'secret') return true
  if (depth <= 0) return true
  if (seen.has(node)) return false
  seen.add(node)
  return nested(node).some(child => hidesSecret(child, seen, depth - 1))
}

interface WalkSink {
  readonly secrets: RedactedSecret[]
  readonly unprovable: string[][]
}

function walk(node: SchemaNode | undefined, value: unknown, path: string[], sink: WalkSink): unknown {
  if (node === undefined) return value
  const { secrets } = sink
  if (node.meta?.role === 'secret') {
    secrets.push({ path, set: value !== undefined })
    return undefined
  }
  switch (node.type) {
    case 'object': {
      const properties = node.dict ?? {}
      const source = isRecord(value) ? value : undefined
      if (source === undefined && value !== undefined && hidesSecret(node)) {
        // A malformed value under a secret-bearing schema: the walker cannot
        // address the secret positions inside it, so nothing in it may pass.
        sink.unprovable.push(path)
        return undefined
      }
      const rebuilt: Record<string, unknown> = {}
      if (source !== undefined) {
        for (const [key, entry] of Object.entries(source)) {
          if (key in properties) continue
          rebuilt[key] = entry
        }
      }
      for (const [key, child] of Object.entries(properties)) {
        const stripped = walk(child, source?.[key], [...path, key], sink)
        if (stripped !== undefined) rebuilt[key] = stripped
      }
      return source === undefined && Object.keys(rebuilt).length === 0 ? value : rebuilt
    }
    case 'dict': {
      if (node.sKey !== undefined && hidesSecret(node.sKey)) {
        // The KEY schema declares the secret, so the key names are the secret.
        // They cannot go in `secrets` either — every entry there names its own
        // path — so the whole dict is withheld and only its position reported.
        if (value === undefined) return value
        sink.unprovable.push(path)
        return undefined
      }
      if (!isRecord(value)) {
        if (value !== undefined && hidesSecret(node)) {
          sink.unprovable.push(path)
          return undefined
        }
        return value
      }
      const rebuilt: Record<string, unknown> = {}
      for (const [key, entry] of Object.entries(value)) {
        const stripped = walk(node.inner, entry, [...path, key], sink)
        if (stripped !== undefined) rebuilt[key] = stripped
      }
      return rebuilt
    }
    case 'array': {
      if (!Array.isArray(value)) {
        if (value !== undefined && hidesSecret(node)) {
          sink.unprovable.push(path)
          return undefined
        }
        return value
      }
      return value.map((entry, index) => walk(node.inner, entry, [...path, String(index)], sink))
    }
    default:
      // Fail closed: a secret reachable only through a container this walker
      // does not descend (union, intersect, transform, tuple) would otherwise
      // ride out verbatim. Withhold the subtree and report the position; a
      // scalar leaf, or a branch set holding no secret at all, is returned as
      // it is.
      if (hidesSecret(node)) {
        sink.unprovable.push(path)
        return undefined
      }
      return value
  }
}

/**
 * Remove every `role('secret')` field a schema declares from a value. The
 * walker follows `object`, `dict`, and `array` containers, so a secret
 * declared on a field reachable through those is removed and enumerated in
 * `secrets`. It fails closed elsewhere: a `union`, `intersect`, `transform`, or
 * `tuple` whose subtree declares a secret is withheld from the value and its
 * path reported in `unprovable`, because this walker cannot say which branch a
 * concrete value took; a `lazy` child is materialized through its builder for
 * the same containment question; and a malformed value under a secret-bearing
 * container (a string where the dict should be) is withheld too, because the
 * secret positions inside it cannot be addressed. Branch sets with no secret
 * in them — a literal enum, say — are returned as they are. The input is
 * never mutated.
 * @param schema - live schemastery schema describing the value.
 * @param value - the value to strip; `undefined` yields an empty record with
 *   object-property secret slots still enumerated.
 * @returns the stripped detached value, the ordered secret positions, and the
 *   positions whose redaction could not be proven.
 */
export function redactSecrets(schema: z<never>, value: unknown): RedactedValue {
  const sink: WalkSink = { secrets: [], unprovable: [] }
  const stripped = walk(schema, value, [], sink)
  return { value: stripped, secrets: sink.secrets, unprovable: sink.unprovable }
}

/**
 * Detach a serialized schemastery envelope (`schema.toJSON()`) with every
 * secret-role node's stored values removed. The envelope's `refs` table is
 * flat — a node buried in a union branch or behind a transform is still its
 * own ref — so stripping `default` and `initial` (schemastery's
 * `.default(...)` writes both) from each `role: 'secret'` ref covers every
 * position the value walker can or cannot reach.
 * @param envelope - the `schema.toJSON()` result.
 * @returns a detached envelope safe to serialize to a wire client.
 */
export function sanitizeSchemaEnvelope(envelope: unknown): unknown {
  const detached = structuredClone(envelope)
  if (!isRecord(detached) || !isRecord(detached['refs'])) return detached
  for (const node of Object.values(detached['refs'])) {
    if (!isRecord(node) || !isRecord(node['meta'])) continue
    if (node['meta']['role'] !== 'secret') continue
    delete node['meta']['default']
    delete node['meta']['initial']
  }
  return detached
}
