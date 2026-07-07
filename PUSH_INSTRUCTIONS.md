# Instructions to Push and Create PR

## Step 1: Push the Branch

Run this command in your terminal:

```bash
git push -u origin dynamic-user-profile
```

If you encounter authentication issues, you may need to:

### Option A: Use GitHub CLI
```bash
gh auth login
git push -u origin dynamic-user-profile
```

### Option B: Use SSH
```bash
git remote set-url origin git@github.com:morelucks/celo-flash.git
git push -u origin dynamic-user-profile
```

### Option C: Use Personal Access Token
1. Go to GitHub Settings → Developer settings → Personal access tokens
2. Generate a new token with `repo` scope
3. Use it when prompted for password

## Step 2: Create Pull Request

### Using GitHub CLI (Recommended)
```bash
gh pr create --title "feat: implement dynamic user profile with wallet connection" --body-file PR_DESCRIPTION.md --base main
```

### Using GitHub Web Interface
1. Go to https://github.com/morelucks/celo-flash
2. You'll see a prompt "Compare & pull request" for the `dynamic-user-profile` branch
3. Click it
4. Copy the content from `PR_DESCRIPTION.md` into the PR description
5. Set base branch to `main` (or your default branch)
6. Click "Create pull request"

## PR Details

**Title:** feat: implement dynamic user profile with wallet connection

**Branch:** dynamic-user-profile → main

**Description:** See PR_DESCRIPTION.md (already created in the repo root)

## Summary

This PR includes:
- ✅ 101 commits with meaningful changes
- ✅ Complete feature implementation
- ✅ Comprehensive documentation
- ✅ No breaking changes
- ✅ Backward compatible
