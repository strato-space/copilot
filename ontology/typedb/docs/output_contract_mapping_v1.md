# Output Contract Mapping v1

## Purpose
Define how `output_contract`, `promise_content`, `admissibility_gate`, and `writeback_gate` map back to runtime product flows.

## Split model
- `output_contract` — typed output surface and operational envelope
- `promise_content` — what the output semantically promises to deliver
- `admissibility_gate` — whether an output is acceptable under evidence/policy
- `writeback_gate` — whether an output may mutate durable object-bound state

## Mapping back to runtime
### Voice / task decomposition
- runtime flow may emit tasks, summaries, patches, or status snapshots
- `output_contract` captures which class of output is expected
- `promise_content` captures the semantic payload
- `admissibility_gate` captures whether evidence is sufficient
- `writeback_gate` captures whether the result may persist back into object-bound notes/conclusions/history

### Summary / artifact flows
- summaries and generated docs map to `artifact_record`
- edits/iterations map to `artifact_patch`
- accepted semantic conclusions map to `object_conclusion`

## Boundary with routing
- `project_context_card` owns stable project-level output defaults and mode/context bindings
- runtime routing payloads remain execution-time objects
- routing decides delivery/execution, not semantic truth
