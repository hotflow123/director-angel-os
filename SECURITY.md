# Security Policy / 安全策略

`Director Angel OS` is pre-`1.0`, and security fixes are handled on a best-effort basis with priority on the default branch and the latest release line.
`Director Angel OS` 当前仍处于 `1.0` 之前阶段，安全修复以尽力而为为原则，优先覆盖默认分支和最新发布线。

## Supported Targets / 支持范围

- Default branch: best-effort security support. 默认分支：提供尽力而为的安全支持。
- Latest published release line: best-effort support when a fix can be safely backported. 最新发布版本线：若能安全回补，则提供尽力而为的支持。
- Older snapshots and historical branches: no guarantee. 更旧的快照和历史分支：不保证提供修复。

## Reporting a Vulnerability / 漏洞报告

- Do not open a public issue for unpatched vulnerabilities. 对未修复漏洞不要直接提公开 issue。
- Use the repository hosting platform's private vulnerability reporting flow or another private maintainer contact if available. 优先使用代码托管平台的私密漏洞报告入口，或其他维护者私下联系方式。
- Include affected paths, impact, reproduction steps, prerequisites, and any proposed mitigation. 请附上受影响路径、影响范围、复现步骤、前置条件和可行缓解方案。
- If you are unsure whether something is security-sensitive, report it privately first. 如果不确定是否属于安全问题，请先私下报告。

## What to Avoid / 请避免

- Do not publish secrets, tokens, internal URLs, or customer data in issues or pull requests. 不要在 issue 或 PR 中公开密钥、令牌、内部地址或用户数据。
- Do not attach exploit proof-of-concept code publicly before maintainers have assessed the issue. 在维护者完成评估前，不要公开贴出漏洞利用 PoC。

## Response Expectations / 响应预期

- Maintainers will acknowledge receipt when possible. 维护者会在条件允许时确认收到报告。
- We will assess severity, decide remediation scope, and coordinate disclosure timing. 我们会评估严重性、确定修复范围，并协调披露时机。
- Fixes may land on the default branch first before any backport decision. 修复可能先落到默认分支，再决定是否回补。

## Secure Contributions / 安全贡献要求

- Use redacted examples for credentials and endpoints. 示例中的凭据和地址必须脱敏。
- Prefer least-privilege defaults and explicit permission boundaries. 默认采用最小权限，并保持权限边界显式。
- Add regression tests when fixing security-sensitive behavior. 修复安全问题时应补充回归测试。
