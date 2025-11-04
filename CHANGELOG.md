# ai-hero-cli

## 0.2.4

### Patch Changes

- 4cb4202: Added branch protection to reset and cherry-pick commands. Prevents resetting current branch or cherry-picking when on target branch or main branch.
- ceb92ce: Add the ability to choose the commit to cherrypick or reset to
- d6e1b24: Fixed a bug where cancelled prompts were not being properly cancelled
- 8c7a4f6: Fixed a bug with get-diffs
- eb09a76: Cherry-picking a commit now hides commits that have already been added to this branch.

## 0.2.3

### Patch Changes

- 743a54d: Fixed bugs with reset and cherrypick

## 0.2.2

### Patch Changes

- 47dd3b0: Made all git commands report their output

## 0.2.1

### Patch Changes

- 26d8957: Added cherry-pick and reset commands

## 0.2.0

### Minor Changes

- 26e77f3: Added get-diffs internal script

## 0.1.1

### Patch Changes

- 772134a: Added the 'next exercise' dialog back to the exercise script.

## 0.1.0

### Minor Changes

- 6fbdbed: Simple mode is now default and only mode. --simple flag throws error message.

## 0.0.26

### Patch Changes

- 1f4d455: Upgrade script now updates vitest to latest version.
- 544e585: Improved exercise search to accept more intuitive formats - users can now search for "03.02" using "3.2"
- 8b70c08: Fix .env file not found error by using correct tsx --env-file flag syntax with equals sign and quotes
- b80b85b: Added lint rule for speaker notes

## 0.0.25

### Patch Changes

- 7a321fe: Made the upload to cloudinary script work on the entire repo
- 621a483: Added evalite to the packages

## 0.0.24

### Patch Changes

- b60fe11: Added upload to cloudinary script

## 0.0.23

### Patch Changes

- f5f5756: Fixed a bug where reading the main file would cause an error because it did not exist.

## 0.0.22

### Patch Changes

- b9a3afd: Added a lint rule that checks for unreferenced reference material.
- 6562f70: Added a lint rule for empty main.ts files

## 0.0.21

### Patch Changes

- 8ce3ec3: Made the kill logic only run if the process is still running

## 0.0.20

### Patch Changes

- d83df9a: Added a debug option
- dddbc44: Another attempted fix for subprocess hanging by explicitly handling SIGINT and SIGTERM.

## 0.0.19

### Patch Changes

- 7b20d9b: Fixed an issue where erroring commands would erroneously log

## 0.0.18

### Patch Changes

- 5844963: Fixed an issue where the exercise subprocess was not being killed

## 0.0.17

### Patch Changes

- 800a9a3: Fixed advanced branch

## 0.0.16

### Patch Changes

- fd8d32d: Wrapped tsx in quotes to work on windows

## 0.0.15

### Patch Changes

- 0f56305: Fixed a bug where it would always show explainer executed
- 23cd2f3: Made the update cvm script error properly

## 0.0.14

### Patch Changes

- 2426351: Choosing the next exercise now shows the name of the exercise.
- 2426351: Made it so that the success and failure text for explainers is clearer.

## 0.0.13

### Patch Changes

- 9492726: Added rename script to AI Hero CLI
- 3c60eb1: Added relative link checking
- e75c29e: Added a rule that checks for PMPM run exercise.

## 0.0.12

### Patch Changes

- 5d9633f: Added internal/lint exercise

## 0.0.11

### Patch Changes

- 868cd1c: I fixed an issue where you couldn't query for exercises if you began the query with a zero.
- 93b1da6: Readme tweak

## 0.0.10

### Patch Changes

- 766960b: Made it so if you pick to run the same exercise again, you won't be prompted for the subfolder
- 766960b: Fixed an issue where invalid subfolders would be offered as selections when running exercises
- 623859c: Added a --simple flag for maximum compatibility on certain systems.

## 0.0.9

### Patch Changes

- 165ff7f: Fixed upgrade script
- 00f6953: Added update-cvm internal script

## 0.0.8

### Patch Changes

- 67dbe64: Made the output CJS

## 0.0.7

### Patch Changes

- e185eb2: Added readme
