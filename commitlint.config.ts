// The conventional types match the shared PR title check:
// build, chore, ci, docs, feat, fix, perf, refactor, revert, style, test.
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "header-max-length": [2, "always", 72],
    "subject-full-stop": [2, "never", "."],
  },
};
