---
name: fetch-issue
description: 'Fetch a single GitHub issue for Chimera from an issue number, #number shorthand, or issue URL using the gh CLI. Use when: reading issue details, planning from a GitHub issue, summarizing issue context, extracting acceptance criteria before implementation.'
argument-hint: 'Issue number or URL (e.g. 42 or https://github.com/jindrichruzicka/Chimera/issues/42)'
---

# Fetch Issue Skill

Fetches one issue with body, labels, milestone, assignees, comments, and URL. Read-only — must not mutate GitHub state.

## Run

```bash
export GH_REPO=jindrichruzicka/Chimera
bash .claude/skills/github/fetch-issue/scripts/fetch-issue.sh <issue-number-or-url>
```

Accepted references:

```bash
bash .claude/skills/github/fetch-issue/scripts/fetch-issue.sh 42
bash .claude/skills/github/fetch-issue/scripts/fetch-issue.sh '#42'
bash .claude/skills/github/fetch-issue/scripts/fetch-issue.sh https://github.com/jindrichruzicka/Chimera/issues/42
```

## Planner Usage

- Run before planning when the user provides an issue number or URL.
- Treat body and comments as task context; extract acceptance criteria, labels, linked docs, open questions.
- If the URL points to another repository, the script uses that URL's owner/repo instead of `GH_REPO`.
- Do not run mutating `gh` commands from this skill.

## Errors

| Error                                          | Cause                                                 | Fix                                            |
| ---------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------- |
| `expected an issue number or GitHub issue URL` | Input is not a number, `#number`, or GitHub issue URL | Re-run with a supported reference              |
| `gh CLI is required`                           | GitHub CLI is missing                                 | `brew install gh && gh auth login`             |
| `unable to fetch issue`                        | Issue missing, inaccessible, or auth failed           | Check the issue reference and `gh auth status` |
