## Summary

Explain the change in plain language.

## Change Type

- [ ] bug fix
- [ ] docs update
- [ ] benchmark or test update
- [ ] release-surface update
- [ ] architecture or runtime change

## Boundary Check

- [ ] this change stays within the current open-source boundary
- [ ] if it changes runtime behavior, the relevant docs were updated
- [ ] if it changes architecture, I referenced the relevant plan or design note

## Verification

- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm bench:all`
- [ ] targeted verification only, explained below

## Notes For Reviewers

Anything security-sensitive, policy-sensitive, or operator-facing that reviewers should pay extra attention to.
