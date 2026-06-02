# Digest template

This template uses Slack `mrkdwn`, not standard Markdown.

```mrkdwn
*GitHub daily digest ({YYYY-MM-DD} UTC)*

*Highlights*
- {owner-or-repo}: {concrete result} <{url}|{link label}>
- {owner-or-repo}: {concrete result} <{url}|{link label}>

*Blockers*
- {repo}: {specific blocker and next action} <{url}|{link label}>

*Follow-ups*
- {owner-or-repo}: {specific follow-up} <{url}|{link label}>
```

Rules:

- Omit `Blockers` when none exist.
- Omit `Follow-ups` when no clear action exists.
- Keep the message short enough to scan in Slack.
- Use Slack links like `<url|label>`; do not use Markdown links like `[label](url)`.
- Use `*Section*` labels; do not use Markdown headings.
- Do not wrap the final Slack message in a code fence.
- Prefer pull request assignee attribution for wins.
- For problems, reference pull request numbers or repository scope rather than person names unless the team policy says otherwise.
