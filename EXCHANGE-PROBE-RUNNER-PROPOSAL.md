# Family Exchange probe: browser-operated GitHub Actions runner (proposal only)

Status: PROPOSAL. Nothing in this file has been created, pushed to another repository, or run. No Appwrite request, key, project or schema exists. The offline candidate stays pinned at commit `95a05b0d1184b921bed95578b90e0b15c2a76080` (tree of `exchange-probe/` = `067949a7f860b46b0f5058507fe7c85060256f3a`). The workflow files below are inert text here: they live in a Markdown file, not under `.github/`.

## 1. Feasibility
Feasible, with one constraint that shapes everything: GitHub only lets you require a human approval before a job can use environment secrets in public repositories on Free, Pro and Team plans. So the runner must be a separate public repository that holds only probe material, and its logs will be world-readable, so they must contain nothing but sanitized results.
Why not the FamilyCircle repository: it is public and already holds four `workflow_dispatch` workflows that read a repository-level `APPWRITE_KEY` (and two other test credentials). Repository-level secrets are visible to every workflow in that repository, on any branch that carries a workflow file. A probe workflow there would sit beside production credentials, and merging it to `main` would be a change to the production repository. A dedicated repository has no production credentials, no Pages deployment and no other workflows, and deleting it removes the workflows, secrets, environments, runs and logs together.

## 2. Repository and workflows
- Repository: a new public repository `LayahMcFly/exchange-probe-runner` (name is a suggestion), containing only `README.md` and `.github/workflows/` with three files. Not created yet.
- Triggers: `workflow_dispatch` only in every file. No `push`, `pull_request` or `schedule`.
- Workflows (full text in section 8): `probe-0-connectivity.yml` (one unauthenticated GET, no secret, no environment), `probe-1-create-schema.yml` (Stage A, environment `probe-schema`), `probe-2-run.yml` (Stage B, environment `probe-run`).
- Stage C is not a workflow. The probe's rows live only in the disposable project, so cleanup is deleting that project in the Appwrite Console after checking its id, plus removing the GitHub secrets and repository. The runner's `cleanup` command is not used, so nothing needs to survive between runs and no artifact is uploaded.
- Each file has `permissions: {}`, a job timeout (3, 15 and 25 minutes), a shared `concurrency` group so two stages cannot overlap, and no `if: always()` step that touches Appwrite. A failed stage simply stops; nothing cleans up automatically. The only `always()` step prints the local, sanitized result file.

## 3. Exact code executed
- No third-party Actions at all: there is no `uses:` line in any file, so there is nothing to pin. The jobs use the runner image's own `git`, `node` and `npm` (label `ubuntu-24.04`, not `latest`). If an Action is ever added, it must be pinned to a full commit SHA, and the repository setting "Require actions to be pinned to a full-length commit SHA" is turned on so an unpinned one is refused.
- The probe source is fetched by full SHA from the public FamilyCircle repository, never by branch name, and verified before anything runs:
  `SOURCE_SHA` = `95a05b0d1184b921bed95578b90e0b15c2a76080`; `exchange-probe/` tree = `067949a7f860b46b0f5058507fe7c85060256f3a`; `schema.manifest.json` blob = `52d4606143d401a7b06050a50014b9baf379b639`; `package-lock.json` blob = `32530cd2dea1f1d9c456a473bc157799b993ef55`.
  The step fails if any of the four differs. The fetch cannot succeed for a commit that is not reachable in that repository, which also fails closed.
- Verified offline with a throwaway script (not committed; results in section 9): the correct pins pass; a different valid commit, a commit with an edited manifest, a commit with an edited lockfile, and a wrong value for each of the three tree/blob pins are each refused. The dispatch guard refuses a wrong confirm text, a non-`main` ref, a non-dispatch event, a project id that does not match, and a project id with unsafe characters. Also confirmed read-only against GitHub: a depth-1 fetch by this full SHA works and returns the four hashes above.
- Dependencies come from `npm ci --ignore-scripts` against the pinned lockfile (4 packages, integrity hashes). The 37 offline tests run before the key is used, in a step that has no secret.
- "Arbitrary user-selected code with the secret" is not possible through the workflow inputs: the only inputs are a typed project id and a typed confirmation phrase, both validated and neither executed. The code that sees the key is fixed by the SHA and tree pins in the workflow file on `main`. Changing those pins means committing to `main` of the runner repository, which needs her account, and each such commit is named in the next approval request.
- Honest limit: someone with write access to the runner repository (only her account) could change the workflow. The environment rules in section 5 plus her account security (two-factor sign-in, which she should confirm is on) are what protect against that. The workflow commit shown on each run's page is compared to the commit named in my approval request before she approves the deployment.

## 4. Secret handling (browser steps, nothing done yet)
Two separate environment secrets in two environments, never repository-level secrets, never workflow inputs:
| Environment | Secret | Used by | Scopes (exact) |
|---|---|---|---|
| `probe-schema` | `PROBE_SETUP_KEY` | `probe-1-create-schema.yml` only | `databases.write`, `tables.write`, `columns.write`, `indexes.write`, `tables.read`, `columns.read`, `indexes.read` |
| `probe-run` | `PROBE_RUN_KEY` | `probe-2-run.yml` only | `rows.read`, `rows.write`, `tables.read`, `columns.read`, `indexes.read` |
Neither key has `keys.*`, `project.*` or any organization scope, and neither is a production key. The setup key is deleted before the run key is created. Expiry is the shortest the Appwrite Console offers that covers the stage.
How the key gets in: she creates the key in the Appwrite Console (probe project only), copies the secret from the Console screen, opens the runner repository in GitHub, Settings, Environments, the right environment, Add environment secret, names it exactly, pastes, saves, then copies something harmless to clear the clipboard. GitHub does not show a saved secret again; it can only be replaced or removed. The key is never typed into chat, a workflow input, a file, an artifact or a command line. Inside the job the value is passed as an environment variable to the single step that runs `node run.js`, not to the fetch, install or test steps, and `run.js` removes it from its environment after reading and masks it in any output. GitHub also masks it in logs, but GitHub states that redaction is not guaranteed, so the plan does not rely on it; the result file is scanned for key-shaped text before it is shown.
Who can use it: a secret in an environment is available only to jobs that reference that environment, and only after its protection rules pass (reviewer approval, branch rule). Repository admins can replace or delete a secret but cannot read it. There are no collaborators planned. Production credentials never enter this repository.
Removal: delete the environment secret right after its stage (Settings, Environments, the environment, secret, delete), revoke the key in the Appwrite Console, then at the end delete both environments and, preferably, the repository. If a key ever appears in a log: delete that run's logs and revoke the key.

## 5. Approval boundaries
- Environments `probe-schema` and `probe-run`: required reviewer `LayahMcFly`; deployment branches limited to `main`; administrators may not bypass. A job that references an environment cannot start, and cannot see its secrets, until the reviewer approves. Because a manually dispatched run uses the workflow file from the branch it is started on, the `main`-only rule is what stops a modified copy on another branch from reaching a secret. Note: with one reviewer, "prevent self-review" cannot be used (she would be unable to approve her own run), so the second click is a deliberate self-approval, not independent review.
- Every live action is two deliberate clicks: Run workflow with two typed values (the project id and a stage phrase `CREATE-SCHEMA`, `RUN-PROBE` or `CHECK-CONNECTIVITY`), then Review deployments, Approve and deploy.
- Separate approvals in my requests, in order: (a) create the runner repository and settings, (b) add the workflow files and environments, (c) connectivity check, (d) the Appwrite project, (e) setup key, (f) Stage A, (g) run key, (h) Stage B, (i) Stage C and removals. Nothing here approves any of them.
- No production upload, activation or enablement is part of this runner. `persistenceVerified` stays false.

## 6. Cost and evidence
- Plans: environments, environment secrets, environment variables, reviewer approval and branch rules are available in public repositories on all current plans; reviewer approval is not available for private repositories on Free, Pro or Team, and if a repository is switched from public to private its protection rules and environment secrets are ignored. So the runner repository must stay public until it is deleted. I could not read her plan (the account API shows none, and this workspace's proxy blocks the settings endpoints), but for a public repository the plan does not matter.
- Minutes: standard GitHub-hosted runners are free for public repositories. Expected use: connectivity about 1 minute, Stage A about 3, Stage B at most 25 (the job timeout), so under 30 minutes in all. No charge is expected and none is approved or assumed. She should confirm the account has no spending limit set above zero for Actions (Settings, Billing and plans) before Stage A; nothing in this plan needs one.
- Retained results: the job log and the job summary of each run, nothing else (no artifacts, no caches). Contents: workflow commit, stage name, project id, endpoint host, the verified source pins, the offline test summary, PASS/FAIL lines with check ids and counts, API call counts against the cap, rows created, and the result JSON (invented values only). No key, no family data. These are readable by anyone because the repository is public. Retention: GitHub keeps logs for 90 days by default and a public repository can set 1 to 90 days; the plan sets 7 days, and she deletes each run after I copy its sanitized results into `FAMILY-EXCHANGE-PROGRESS.md` (which keeps the project id and results, no secrets). Deleting the repository removes whatever remains.
- Evidence wording is unchanged: a result is evidence about that project, configuration and the schedules observed, not production verification, and a passing run does not prove every concurrency schedule.

## 7. Browser steps, in order (each needs its own approval first; none is done)
1. Create the repository. GitHub, New repository, name `exchange-probe-runner`, Public, add a README, no licence file, no other files. Do not enable Pages.
2. Settings, Actions, General: Actions permissions "Allow select actions" with nothing added; turn on "Require actions to be pinned to a full-length commit SHA"; workflow permissions "Read repository contents"; leave "Allow GitHub Actions to create and approve pull requests" off; fork pull request workflows "Require approval for all external contributors"; artifact and log retention 7 days.
3. Add the three workflow files: Add file, Create new file, path `.github/workflows/<name>.yml`, paste the text from section 8, commit directly to `main`. I then fetch the public files at that commit and compare them byte for byte with the reviewed text, and name the commit in the next request. No code is pushed by me to this repository unless she grants and I confirm access.
4. Settings, Environments, New environment `probe-schema` and `probe-run`: required reviewer yourself; deployment branches "Selected branches" `main`; uncheck "Allow administrators to bypass". No secrets yet.
5. After the Appwrite project exists (separate approval): in each environment add the variable `PROBE_PROJECT_ID` with the project id (not a secret).
6. Connectivity check (separate approval): Actions, `probe-0-connectivity`, Run workflow on `main`, type `CHECK-CONNECTIVITY`, Run. No environment, no secret. It prints the HTTP status and the Appwrite version from one GET to `https://nyc.cloud.appwrite.io/v1/health/version`.
7. Stage A (separate approvals for the key and the stage): create the setup key in the Console; add `PROBE_SETUP_KEY` to `probe-schema`; Actions, `probe-1-create-schema`, Run workflow on `main`, project id and `CREATE-SCHEMA`; open the run, Review deployments, tick `probe-schema`, Approve and deploy; read the summary; delete the secret; revoke the key.
8. Stage B (separate approvals): create the run key; add `PROBE_RUN_KEY` to `probe-run`; Actions, `probe-2-run`, Run workflow on `main`, project id and `RUN-PROBE`; approve the deployment; read the summary; delete the secret; revoke the key.
9. Stage C (separate approval): check the project id in the Console equals the recorded id, delete the project; compare the organization's project list with the pre-probe inventory; delete both environments; delete the runs; delete the repository.

## 8. The workflow files (reviewed text)

### `.github/workflows/probe-0-connectivity.yml`

```yaml
name: probe-0-connectivity (one unauthenticated GET)
on:
  workflow_dispatch:
    inputs:
      confirm:
        description: "Type exactly: CHECK-CONNECTIVITY"
        required: true
        type: string
permissions: {}
jobs:
  check:
    runs-on: ubuntu-24.04
    timeout-minutes: 3
    steps:
      - name: One GET, no key, no project header
        env:
          CONFIRM: ${{ inputs.confirm }}
        run: |
          set -euo pipefail
          [ "$GITHUB_EVENT_NAME" = workflow_dispatch ]
          [ "$GITHUB_REF" = refs/heads/main ]
          [ "$CONFIRM" = "CHECK-CONNECTIVITY" ]
          code=$(curl -sS --max-time 20 -o body.txt -w '%{http_code}' https://nyc.cloud.appwrite.io/v1/health/version)
          echo "status $code"
          head -c 300 body.txt; echo
```

### `.github/workflows/probe-1-create-schema.yml`

```yaml
name: probe-1-create-schema (Stage A, creates the schema)
on:
  workflow_dispatch:
    inputs:
      expect_project:
        description: Probe project id, typed by hand
        required: true
        type: string
      confirm:
        description: "Type exactly: CREATE-SCHEMA"
        required: true
        type: string
permissions: {}
concurrency:
  group: exchange-probe
  cancel-in-progress: false
env:
  SOURCE_REPO: https://github.com/LayahMcFly/FamilyCircle.git
  SOURCE_SHA: 95a05b0d1184b921bed95578b90e0b15c2a76080
  SOURCE_TREE: 067949a7f860b46b0f5058507fe7c85060256f3a
  MANIFEST_BLOB: 52d4606143d401a7b06050a50014b9baf379b639
  LOCK_BLOB: 32530cd2dea1f1d9c456a473bc157799b993ef55
  ENDPOINT: https://nyc.cloud.appwrite.io/v1
jobs:
  stage:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    environment: probe-schema
    steps:
      - name: Refuse anything but a deliberate dispatch from main
        env:
          CONFIRM: ${{ inputs.confirm }}
          EXPECT: ${{ inputs.expect_project }}
          PROJECT: ${{ vars.PROBE_PROJECT_ID }}
        run: |
          set -euo pipefail
          [ "$GITHUB_EVENT_NAME" = workflow_dispatch ]
          [ "$GITHUB_REF" = refs/heads/main ]
          [ "$CONFIRM" = "CREATE-SCHEMA" ]
          printf '%s' "$EXPECT" | grep -Eq '^[A-Za-z0-9_-]{1,36}$'
          [ "$EXPECT" = "$PROJECT" ]
          echo "workflow commit $GITHUB_SHA, stage A create-schema, project $PROJECT"
      - name: Fetch the reviewed source and refuse any other
        run: |
          set -euo pipefail
          node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)'
          mkdir src && cd src && git init -q && git remote add origin "$SOURCE_REPO"
          git fetch -q --depth 1 origin "$SOURCE_SHA"
          git checkout -q --detach FETCH_HEAD
          test "$(git rev-parse HEAD)" = "$SOURCE_SHA"
          test "$(git rev-parse HEAD:exchange-probe)" = "$SOURCE_TREE"
          test "$(git rev-parse HEAD:exchange-probe/schema.manifest.json)" = "$MANIFEST_BLOB"
          test "$(git rev-parse HEAD:exchange-probe/package-lock.json)" = "$LOCK_BLOB"
          echo "source $SOURCE_SHA, exchange-probe tree $SOURCE_TREE verified"
      - name: Install pinned dependencies and run the offline tests (no key present)
        working-directory: src/exchange-probe
        run: |
          set -euo pipefail
          npm ci --ignore-scripts
          npm test
      - name: Create the manifest schema, then read it back
        working-directory: src/exchange-probe
        env:
          PROBE_ENDPOINT: ${{ env.ENDPOINT }}
          PROBE_PROJECT_ID: ${{ vars.PROBE_PROJECT_ID }}
          PROBE_APPWRITE_KEY: ${{ secrets.PROBE_SETUP_KEY }}
          EXPECT: ${{ inputs.expect_project }}
        run: |
          set -euo pipefail
          node run.js create-schema --expect-project "$EXPECT"
          node run.js verify-schema --expect-project "$EXPECT"
      - name: Show the sanitized result (never uploads anything)
        if: always()
        working-directory: src/exchange-probe
        run: |
          set -u
          for f in out/run-*.json; do
            [ -f "$f" ] || continue
            if grep -Eq '(standard|ephemeral|dynamic)_[A-Za-z0-9]{16,}' "$f"; then echo "result file looks key-shaped; not printed"; continue; fi
            { echo '```json'; cat "$f"; echo '```'; } >> "$GITHUB_STEP_SUMMARY"
          done
```

### `.github/workflows/probe-2-run.yml`

```yaml
name: probe-2-run (Stage B, runs the probe)
on:
  workflow_dispatch:
    inputs:
      expect_project:
        description: Probe project id, typed by hand
        required: true
        type: string
      confirm:
        description: "Type exactly: RUN-PROBE"
        required: true
        type: string
permissions: {}
concurrency:
  group: exchange-probe
  cancel-in-progress: false
env:
  SOURCE_REPO: https://github.com/LayahMcFly/FamilyCircle.git
  SOURCE_SHA: 95a05b0d1184b921bed95578b90e0b15c2a76080
  SOURCE_TREE: 067949a7f860b46b0f5058507fe7c85060256f3a
  MANIFEST_BLOB: 52d4606143d401a7b06050a50014b9baf379b639
  LOCK_BLOB: 32530cd2dea1f1d9c456a473bc157799b993ef55
  ENDPOINT: https://nyc.cloud.appwrite.io/v1
jobs:
  stage:
    runs-on: ubuntu-24.04
    timeout-minutes: 25
    environment: probe-run
    steps:
      - name: Refuse anything but a deliberate dispatch from main
        env:
          CONFIRM: ${{ inputs.confirm }}
          EXPECT: ${{ inputs.expect_project }}
          PROJECT: ${{ vars.PROBE_PROJECT_ID }}
        run: |
          set -euo pipefail
          [ "$GITHUB_EVENT_NAME" = workflow_dispatch ]
          [ "$GITHUB_REF" = refs/heads/main ]
          [ "$CONFIRM" = "RUN-PROBE" ]
          printf '%s' "$EXPECT" | grep -Eq '^[A-Za-z0-9_-]{1,36}$'
          [ "$EXPECT" = "$PROJECT" ]
          echo "workflow commit $GITHUB_SHA, stage B run, project $PROJECT"
      - name: Fetch the reviewed source and refuse any other
        run: |
          set -euo pipefail
          node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)'
          mkdir src && cd src && git init -q && git remote add origin "$SOURCE_REPO"
          git fetch -q --depth 1 origin "$SOURCE_SHA"
          git checkout -q --detach FETCH_HEAD
          test "$(git rev-parse HEAD)" = "$SOURCE_SHA"
          test "$(git rev-parse HEAD:exchange-probe)" = "$SOURCE_TREE"
          test "$(git rev-parse HEAD:exchange-probe/schema.manifest.json)" = "$MANIFEST_BLOB"
          test "$(git rev-parse HEAD:exchange-probe/package-lock.json)" = "$LOCK_BLOB"
          echo "source $SOURCE_SHA, exchange-probe tree $SOURCE_TREE verified"
      - name: Install pinned dependencies and run the offline tests (no key present)
        working-directory: src/exchange-probe
        run: |
          set -euo pipefail
          npm ci --ignore-scripts
          npm test
      - name: Run the probe
        working-directory: src/exchange-probe
        env:
          PROBE_ENDPOINT: ${{ env.ENDPOINT }}
          PROBE_PROJECT_ID: ${{ vars.PROBE_PROJECT_ID }}
          PROBE_APPWRITE_KEY: ${{ secrets.PROBE_RUN_KEY }}
          EXPECT: ${{ inputs.expect_project }}
        run: |
          set -euo pipefail
          node run.js run --expect-project "$EXPECT"
      - name: Show the sanitized result (never uploads anything)
        if: always()
        working-directory: src/exchange-probe
        run: |
          set -u
          for f in out/run-*.json; do
            [ -f "$f" ] || continue
            if grep -Eq '(standard|ephemeral|dynamic)_[A-Za-z0-9]{16,}' "$f"; then echo "result file looks key-shaped; not printed"; continue; fi
            { echo '```json'; cat "$f"; echo '```'; } >> "$GITHUB_STEP_SUMMARY"
          done
```

## 9. Offline evidence
- YAML parses; each file's only trigger is `workflow_dispatch`; no file contains `uses:`; the `probe-schema` and `probe-run` jobs reference their own environments; the connectivity job references none.
- The two shell steps that guard dispatch and verify the source were extracted from the YAML and run against a local repository holding the reviewed commit plus two tampered commits (edited manifest, edited lockfile): 13 cases, 13 as expected (see section 3).
- Not tested, because they need GitHub or Appwrite: environment approval screens, secret injection, masking, the Appwrite calls themselves, and runner-side Node availability (the first step refuses a Node older than 20).

## Sources
GitHub documentation: managing environments for deployment; deployments and environments reference; manually running a workflow; secure use reference; usage limits, billing and administration; how use of GitHub Actions is measured.
