# Flow blocks

A fenced code block whose language is `flow` renders a small deterministic
flow diagram in chat. The body is JSON; no Mermaid, HTML, or scripts are
involved. If the payload is not valid JSON, is missing `nodes`, or references
an unknown node from an edge or group, the renderer falls back to a normal code
block with the raw source.

The renderer maps the graph to rows (longest-path ranks), draws orthogonal
connectors between adjacent rows, and gives every edge its own horizontal lane
so branch and merge arrows never overlap. Long edges get an invisible
pass-through lane in the rows they cross. Cycles are broken deterministically;
edges that would point back up the diagram (or have `"kind": "return"`) are
listed beneath it as return links instead of being drawn over other rows.

Rows keep a minimum card width and the figure scrolls horizontally on narrow
screens, so branches stay aligned instead of wrapping and losing their arrows.

## Example

````markdown
```flow
{
  "title": "Decision flow",
  "subtitle": "One request, three lanes, one verification gate",
  "nodes": [
    { "id": "intake", "label": "Incoming task / observation", "detail": "user message or scheduled trigger", "icon": "inbox" },
    { "id": "router", "label": "Decision layer", "detail": "classify · score · route · filter", "icon": "git-branch", "tone": "live" },
    { "id": "deterministic", "label": "Deterministic", "detail": "code / rules", "icon": "cpu", "tone": "green" },
    { "id": "small", "label": "Small model", "detail": "simple tasks", "icon": "zap", "tone": "operator" },
    { "id": "strong", "label": "Strong model", "detail": "complex tasks", "icon": "brain", "tone": "purple" },
    { "id": "verify", "label": "Execution + verification", "detail": "tests, policies, optional screening", "icon": "shield" }
  ],
  "edges": [
    { "from": "intake", "to": "router" },
    { "from": "router", "to": "deterministic", "label": "rules", "kind": "branch" },
    { "from": "router", "to": "small", "label": "simple", "kind": "branch" },
    { "from": "router", "to": "strong", "label": "complex", "kind": "branch" },
    { "from": "deterministic", "to": "verify" },
    { "from": "small", "to": "verify" },
    { "from": "strong", "to": "verify" },
    { "from": "verify", "to": "router", "label": "retry", "kind": "return" }
  ],
  "groups": [
    { "label": "Decision", "nodes": ["router"] },
    { "label": "Execution", "nodes": ["verify"] }
  ]
}
```
````

## Fields

| Field | Required | Notes |
| --- | --- | --- |
| `title` | no | Short uppercase caption at the top; max 140 characters. |
| `subtitle` | no | One supporting line; max 240 characters. |
| `nodes` | yes | 1–40 entries. A flow with no edges stacks in declaration order. |
| `nodes[].id` | yes | Unique within the block; max 64 characters. |
| `nodes[].label` | yes | 1–120 characters, wrapped and centred in the card. |
| `nodes[].detail` | no | Up to 240 characters, muted second line. |
| `nodes[].icon` | no | One of the icon names below; unknown names render no icon. |
| `nodes[].tone` | no | `neutral` (default), `live`, `operator`, `green`, `purple`, `red`. Unknown tones fall back to neutral. |
| `edges` | no | 0–120 entries. `from`/`to` must name real nodes. |
| `edges[].label` | no | Up to 60 characters; drawn on the connector. |
| `edges[].kind` | no | `flow` (default), `branch`, or `return`. Branching is expressed by multiple outgoing edges; `return` is drawn as a footnote. |
| `groups` | no | 0–8 entries. `{ "label", "nodes": ["id", ...] }`; the caption sits above the earliest row containing a member. Annotation only. |

Icon names: `alert`, `bot`, `brain`, `check`, `check-circle`, `circle`, `clock`,
`cloud`, `code`, `cpu`, `database`, `eye`, `file`, `filter`, `gauge`,
`git-branch`, `git-merge`, `globe`, `inbox`, `layers`, `lock`, `message`,
`package`, `plug`, `refresh`, `route`, `scale`, `search`, `send`, `server`,
`settings`, `shield`, `sparkles`, `split`, `terminal`, `user`, `workflow`,
`wrench`, `zap`.

The canonical sample lives in `flowSample.ts` (`FLOW_SAMPLE_SPEC`,
`FLOW_SAMPLE_MARKDOWN`) and is covered by `flowSpec.test.ts` and
`FlowBlock.test.tsx`.
