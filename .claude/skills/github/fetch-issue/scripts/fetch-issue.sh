#!/usr/bin/env bash
# .claude/skills/github/fetch-issue/scripts/fetch-issue.sh <issue-number-or-url>
#
# Fetches a single GitHub issue through the gh CLI. Numbers default to the
# Chimera repository; issue URLs provide their own repository.

set -euo pipefail

DEFAULT_GH_REPO="jindrichruzicka/Chimera"

usage() {
    echo "Usage: $(basename "$0") <issue-number-or-url>" >&2
    echo "Provide an issue number, #number shorthand, or GitHub issue URL." >&2
}

if [[ $# -ne 1 ]]; then
    usage
    exit 1
fi

raw_issue_ref="$1"
repo="${GH_REPO:-${DEFAULT_GH_REPO}}"
issue_number=""

if [[ "${raw_issue_ref}" =~ ^#([0-9]+)$ ]]; then
    issue_number="${BASH_REMATCH[1]}"
elif [[ "${raw_issue_ref}" =~ ^[0-9]+$ ]]; then
    issue_number="${raw_issue_ref}"
elif [[ "${raw_issue_ref}" =~ ^https://github\.com/([^/]+)/([^/]+)/issues/([0-9]+)/?([?#].*)?$ ]]; then
    repo="${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
    issue_number="${BASH_REMATCH[3]}"
else
    echo "Error: expected an issue number or GitHub issue URL." >&2
    usage
    exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
    echo "Error: gh CLI is required. Install with 'brew install gh' and authenticate with 'gh auth login'." >&2
    exit 127
fi

JQ_FILTER='
def names($items): if ($items | length) == 0 then "none" else ($items | join(", ")) end;
"#\(.number) \(.title)
State: \(.state)
URL: \(.url)
Author: \(.author.login // "unknown")
Labels: \(names([.labels[].name]))
Assignees: \(names([.assignees[].login]))
Milestone: \(.milestone.title // "none")
Created: \(.createdAt)
Updated: \(.updatedAt)

## Body
\(.body // "")

## Comments
\(if (.comments | length) == 0 then "No comments." else (.comments | map("### \(.author.login // "unknown") at \(.createdAt)\n\(.body // "")") | join("\n\n")) end)"
'

if ! gh issue view "${issue_number}" \
        --repo "${repo}" \
        --json number,title,state,author,body,labels,assignees,milestone,createdAt,updatedAt,url,comments \
        --jq "${JQ_FILTER}"; then
    echo "Error: unable to fetch issue '${raw_issue_ref}' from ${repo}." >&2
    exit 1
fi