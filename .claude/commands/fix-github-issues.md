Fetch all open GitHub issues for this repository, prioritise them, then fix and ship the highest priority one.

## Steps

### 1. Fetch issues
Run `gh issue list --repo maghilnan/<repo_name> --state open --json number,title,body,assignees,labels,createdAt` to get all open issues with full details.

### 2. Prioritise
Rank the issues by the following criteria (highest to lowest):
- **Critical** — crashes, data loss, or complete feature breakage
- **High** — core feature is broken but has a workaround
- **Medium** — degraded UX, minor bugs
- **Low** — cosmetic issues, nice-to-haves

Print the prioritised list to the user before proceeding, clearly stating which issue you are going to fix and why it is the highest priority. If there are no open issues, tell the user and stop.

### 3. Understand the issue
Read the issue title and body carefully. Search the codebase to find the relevant files. Read those files before making any changes.

### 4. Fix
Implement the minimal fix required to resolve the issue. Do not refactor surrounding code or make unrelated changes.

### 5. Commit and push
Stage only the files changed for this fix. Write a commit message in this format:

```
<short imperative summary> (closes #<issue-number>)

<2–4 sentences explaining the root cause and what was changed to fix it.>

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
```

Push to the remote branch.

### 6. Comment on the issue
Post a comment on the GitHub issue using `gh issue comment` that includes:
- **Root cause** — what was wrong and why
- **Fix** — what changed, referencing the specific file(s) and commit hash

The `closes #<number>` in the commit message will automatically close the issue on GitHub when the commit reaches the default branch.
