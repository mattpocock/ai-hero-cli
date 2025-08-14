# AI Hero CLI

A command-line interface tool designed to help students navigate and run AI Hero exercises efficiently.

## Overview

The AI Hero CLI is a specialized tool that makes it easy to:

- Browse and select exercises from the AI Hero course
- Run exercises with proper environment setup
- Navigate between exercises seamlessly
- Get exercise instructions and context

## Installation

This CLI is typically pre-installed in AI Hero exercise repositories. If you need to install it manually:

```bash
pnpm add -D ai-hero-cli
```

## Usage

### Basic Commands

#### Run an Exercise

```bash
# Run a specific exercise by lesson number
ai-hero exercise 1

# Run a specific exercise with subfolder
ai-hero exercise 1 --subfolder 2

# Browse and select an exercise interactively
ai-hero exercise
```

#### Command Options

- `--root`: Directory to look for lessons (default: current directory)
- `--env-file`: Path to environment file (default: `.env` in current directory)
- `--cwd`: Working directory to run the command in (default: current directory)

### Interactive Features

When running an exercise, the CLI provides an interactive interface with several shortcuts:

- **Enter**: Choose a new exercise to run
- **n**: Go to the next exercise
- **p**: Go to the previous exercise
- **q**: Quit the current exercise
- **h**: Show all available shortcuts

### Exercise Navigation

The CLI automatically detects the structure of your AI Hero exercises and provides seamless navigation:

1. **Exercise Selection**: Use the interactive menu to browse and search through available exercises
2. **Subfolder Support**: If an exercise has multiple subfolders, you'll be prompted to select one
3. **Progressive Navigation**: Easily move to the next or previous exercise in the course
4. **Context Preservation**: The CLI remembers your position and provides relevant navigation options

### Exercise Execution

When you run an exercise:

1. The CLI clears the terminal and displays the exercise information
2. Shows the exercise instructions (if available in `readme.md`)
3. Runs the exercise using `pnpm tsx` with your environment variables
4. Provides interactive controls while the exercise is running
5. Offers options when the exercise completes or encounters an error

### Post-Exercise Options

After an exercise completes, you can:

- **Run Again**: Retry the current exercise
- **Next Exercise**: Automatically move to the next exercise in the sequence
- **Previous Exercise**: Go back to the previous exercise
- **Choose Exercise**: Browse and select a different exercise
- **Finish**: Exit the CLI

## Internal Commands

The CLI also includes internal commands for maintenance:

```bash
# Upgrade AI SDK packages
ai-hero internal upgrade

# Upgrade with verbose output
ai-hero internal upgrade --verbose
```

## File Structure Expectations

The CLI expects your AI Hero exercises to follow this structure:

```
exercises/
├── 1-section-name/
│   ├── 1-exercise-name/
│   │   ├── main.ts
│   │   └── readme.md
│   └── 2-another-exercise/
│       ├── main.ts
│       └── readme.md
```

- Each exercise should have a `main.ts` file as the entry point
- Optional `readme.md` files provide exercise instructions
- Exercise and section names should start with a number followed by a hyphen

## Environment Setup

The CLI automatically loads environment variables from:

- `.env` file in the current directory (default)
- Custom env file specified with `--env-file` option

Make sure your `.env` file contains any necessary API keys or configuration for the exercises.

## Troubleshooting

### Getting Help

- Use `h` during exercise execution to see available shortcuts
- Check the exercise's `readme.md` file for specific instructions
- Ensure all dependencies are installed with `pnpm install`

---

**Note**: This CLI is specifically designed for AI Hero exercises and is not intended for general use outside of the AI Hero course context.
