# recombyn-runtime

Open helpers shared by Design API Runtime and optional remote Intelligence
providers:

- `build_intelligence_request` — HTTP POST body for `/v1/{method}`

Empty / stub remote responses are gated by `remote_result_usable` in
`recombyn-protocol` (import from there). Full LangGraph / Scene apply stay in
the API. Kernel stage names live in `recombyn-agent-sdk`. Proprietary provider
internals are out of scope.
