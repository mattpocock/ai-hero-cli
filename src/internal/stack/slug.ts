import { Console, Effect } from "effect";
import type { BranchCommit } from "../../branch-commits.js";
import { PromptService } from "../../prompt-service.js";

/** The parse boundary a slug must never contain. */
const LESSON_ID_BOUNDARY = ": ";

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type SlugRejection = { ok: false; reason: string };
export type SlugCheck = { ok: true } | SlugRejection;

/**
 * Whether `slug` may be used as a lesson id.
 *
 * This is the first place in the CLI where the slug convention is enforced in
 * code rather than in prose — every other command reuses a message that
 * already exists, so nothing has ever had to validate one. The rules come from
 * the maintainer's contract: kebab-case, no `": "` (it *is* the parse
 * boundary), and unique within the stack, because `reset` silently picks the
 * latest of a duplicate pair.
 */
export const checkSlug = (opts: {
  slug: string;
  commits: Array<BranchCommit>;
  /** A slug already owned by the commit being renamed, which may be kept. */
  allowExisting?: string | undefined;
}): SlugCheck => {
  const slug = opts.slug.trim();

  if (slug === "") {
    return { ok: false, reason: "A slug is required." };
  }

  if (slug.includes(LESSON_ID_BOUNDARY)) {
    return {
      ok: false,
      reason: `A slug cannot contain "${LESSON_ID_BOUNDARY}" — that is the parse boundary.`,
    };
  }

  if (!KEBAB_CASE.test(slug)) {
    return {
      ok: false,
      reason:
        "A slug must be lowercase kebab-case (e.g. add-settings-json).",
    };
  }

  const isDuplicate = opts.commits.some(
    (commit) =>
      commit.lessonId === slug && slug !== opts.allowExisting
  );

  if (isDuplicate) {
    return {
      ok: false,
      reason: `"${slug}" is already used by another lesson. Slugs must be unique — a duplicate is a silent trap for \`reset\`.`,
    };
  }

  return { ok: true };
};

/** Compose a lesson commit subject from its two halves. */
export const composeSubject = (opts: {
  slug: string;
  title: string;
}) => `${opts.slug.trim()}${LESSON_ID_BOUNDARY}${opts.title.trim()}`;

/**
 * Prompt for a slug and then a title, re-prompting until the slug is valid.
 *
 * Both prompts take an initial value, so `rename-commit` can prefill the
 * current values and Enter-Enter is a no-op.
 */
export const promptForSubject = (opts: {
  commits: Array<BranchCommit>;
  initialSlug?: string | undefined;
  initialTitle?: string | undefined;
  allowExisting?: string | undefined;
}) =>
  Effect.gen(function* () {
    const prompts = yield* PromptService;

    let slug: string;
    while (true) {
      const entered = yield* prompts.inputSlug(opts.initialSlug);
      const check = checkSlug({
        slug: entered,
        commits: opts.commits,
        allowExisting: opts.allowExisting,
      });

      if (check.ok) {
        slug = entered.trim();
        break;
      }

      yield* Console.log(`\n✗ ${check.reason}\n`);
    }

    let title: string;
    while (true) {
      const entered = yield* prompts.inputTitle(opts.initialTitle);
      if (entered.trim() !== "") {
        title = entered.trim();
        break;
      }
      yield* Console.log("\n✗ A title is required.\n");
    }

    return { slug, title, subject: composeSubject({ slug, title }) };
  });
