# Optional managed service

The extension can run entirely in Local BYOK mode. This package provides the optional managed path for reviewers and users who prefer not to configure provider credentials.

## Configuration

Set at least one managed provider key in the deployment:

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Enables supported OpenAI models. |
| `ANTHROPIC_API_KEY` | Enables supported Anthropic models. |
| `LENSES_MANAGED_DIAGNOSTICS` | Optional metadata diagnostics when set to `true`; request questions and source excerpts are not logged. |

Model and test-model overrides remain available through `OPENAI_MODEL`, `OPENAI_TEST_MODEL`, `ANTHROPIC_MODEL`, and `ANTHROPIC_TEST_MODEL`.

Managed mode requires no reviewer account, access code, grant token, or internal allowance. Requests are bounded by source size, output, reasoning, and web-tool limits, but the public HTTP routes are otherwise ungated. Treat the deployment URL and provider keys accordingly: anyone who can reach those routes can spend the configured provider account.

## Data boundary

Lenses, runs, findings, evidence bases, saved selections, and conversations remain in the browser in both Managed and Local BYOK modes. Managed requests send only the bounded context needed for that AI operation. The backend uses short-lived, content-free rows solely to cancel in-flight managed runs.
