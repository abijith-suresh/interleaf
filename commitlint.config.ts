const types = ["feat", "fix", "docs", "refactor", "chore", "test", "ci", "build"];

export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [2, "always", types],
    "header-max-length": [2, "always", 72],
    "subject-full-stop": [2, "never", "."],
  },
};
