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
  dict?: Record<string, SchemaNode>
  /** `dict`/`array` element schema, and `transform`'s source schema. */
  inner?: SchemaNode
  /** `union`/`intersect` branches and `tuple` members. */
  list?: SchemaNode[]
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

/** Every nested schema a node holds, whichever container names it uses. */
function nested(node: SchemaNode): SchemaNode[] {
  return [
    ...node.inner === undefined ? [] : [node.inner],
    ...node.list ?? [],
    ...Object.values(node.dict ?? {}),
  ]
}

/**
 * Whether a secret role sits anywhere under a node. Used only on nodes the
 * walker does not descend, where a positive answer means the value cannot be
 * proven free of secrets and must be withheld.
 */
function hidesSecret(node: SchemaNode): boolean {
  return node.meta?.role === 'secret' || nested(node).some(hidesSecret)
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
      if (!isRecord(value)) return value
      const rebuilt: Record<string, unknown> = {}
      for (const [key, entry] of Object.entries(value)) {
        const stripped = walk(node.inner, entry, [...path, key], sink)
        if (stripped !== undefined) rebuilt[key] = stripped
      }
      return rebuilt
    }
    case 'array': {
      if (!Array.isArray(value)) return value
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
 * concrete value took. Branch sets with no secret in them — a literal enum,
 * say — are returned as they are. The input is never mutated.
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
