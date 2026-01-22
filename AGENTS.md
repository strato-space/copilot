# Copilot Workspace Guidelines

This repository is the umbrella workspace for three related modules:
- **OperOps** (`operops/`)
- **FinOps** (`finance-ops/`)
- **ChatOps** (`chatops/`)

## Shared rules (apply to all modules)
- Keep each module deployable and updateable independently.
- Use the same visual language and tone across modules.
- Document changes in the module itself; shared notes can live in this repo root.
- Do not store build artifacts outside the module directories.
- For `finance-ops/admin_app`, keep only TypeScript/TSX sources and avoid JS duplicates.

## Deployment endpoints
- `copilot.stratospace.fun` → portal (`frontend/`)
- `operops.stratospace.fun` → OperOps placeholder (`operops/site/`)
- `finops.stratospace.fun` → FinOps frontend (`finance-ops/admin_app/dist`)
- `chatops.stratospace.fun` → ChatOps placeholder (`chatops/site/`)
