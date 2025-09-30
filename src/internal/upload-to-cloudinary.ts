import { Command as CLICommand, Options } from "@effect/cli";
import { FileSystem } from "@effect/platform";
import { v2 as cloudinary } from "cloudinary";
import * as dotenv from "dotenv";
import {
  Array as EffectArray,
  Console,
  Data,
  Effect,
  flow,
} from "effect";
import * as path from "path";
import { envFilePathOption, rootOption } from "../options.js";
import { LessonParserService } from "../lesson-parser-service.js";

class CloudinaryUrlNotSetError extends Data.TaggedError(
  "CloudinaryUrlNotSetError"
)<{
  message: string;
}> {}

class CouldNotParseCloudinaryUrlError extends Data.TaggedError(
  "CouldNotParseCloudinaryUrlError"
)<{
  message: string;
}> {}

class NoImagesFoundError extends Data.TaggedError(
  "NoImagesFoundError"
)<{
  message: string;
}> {}

class EnvFileError extends Data.TaggedError("EnvFileError")<{
  message: string;
  cause: unknown;
}> {}

class EnvFileEmptyError extends Data.TaggedError(
  "EnvFileEmptyError"
)<{
  path: string;
}> {}

class ImageUploadError extends Data.TaggedError(
  "ImageUploadError"
)<{
  message: string;
  cause: unknown;
}> {}

// This command:
// 0. Fails if there is no CLOUDINARY_URL environment variable
// 1. Extracts references to images in the markdown file
// 2. Finds the images based on the references
// 2a. If the image is relative, use the relative path from the folder containing the markdown file
// 2b. If the image is absolute (i.e. starts with '/'), resolve it based on the working directory
// 3. Uploads the images to Cloudinary via the CLOUDINARY_URL environment variable
// 4. Replaces the references in the markdown file with the URLs of the uploaded images
export const uploadToCloudinary = CLICommand.make(
  "upload-to-cloudinary",
  {
    root: rootOption,
    cwd: Options.text("cwd").pipe(
      Options.withDescription("The working directory"),
      Options.withDefault(process.cwd())
    ),
    envFilePath: envFilePathOption,
  },
  Effect.fn("upload-to-cloudinary")(function* ({
    cwd,
    envFilePath,
    root,
  }) {
    const fs = yield* FileSystem.FileSystem;
    const envConfig = dotenv.config({
      path: envFilePath,
      quiet: true,
    });

    if (envConfig.error) {
      return yield* new EnvFileError({
        message: "Error loading environment file",
        cause: envConfig.error,
      });
    }

    if (envConfig.parsed === undefined) {
      return yield* new EnvFileEmptyError({
        path: envFilePath,
      });
    }

    const CLOUDINARY_URL = envConfig.parsed.CLOUDINARY_URL;

    if (!CLOUDINARY_URL) {
      return yield* new CloudinaryUrlNotSetError({
        message:
          "CLOUDINARY_URL environment variable is not set",
      });
    }

    const { apiKey, apiSecret, cloudName } =
      yield* parseCloudinaryUrl(CLOUDINARY_URL);

    cloudinary.config({
      api_key: apiKey,
      api_secret: apiSecret,
      cloud_name: cloudName,
    });

    const lessonParserService = yield* LessonParserService;

    const lessons =
      yield* lessonParserService.getLessonsFromRepo(root);

    const readmeFiles: Array<string> = [];

    for (const lesson of lessons) {
      const allFiles = yield* lesson.allFiles();

      const foundReadmes = allFiles.filter((file) =>
        file.includes("readme.md")
      );

      for (const readmeFile of foundReadmes) {
        readmeFiles.push(readmeFile);
      }
    }

    for (const readmeFile of readmeFiles) {
      // Read the markdown file
      const fileContent = yield* fs.readFileString(readmeFile);

      // Extract image references from markdown
      const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
      const imageMatches = Array.from(
        fileContent.matchAll(imageRegex)
      );

      if (imageMatches.length === 0) {
        return yield* new NoImagesFoundError({
          message: "No images found in the markdown file",
        });
      }

      let updatedContent = fileContent;
      const markdownDir = path.dirname(readmeFile);

      // Process each image
      for (const [
        fullMatch,
        altText,
        imagePath,
      ] of imageMatches) {
        let resolvedImagePath: string;

        // Resolve image path based on whether it's relative or absolute
        if (imagePath.startsWith("/")) {
          // Absolute path - resolve from working directory
          resolvedImagePath = path.resolve(
            cwd,
            // Remove the leading slash
            imagePath.slice(1)
          );
        } else if (imagePath.startsWith("http")) {
          // URL - skip
          continue;
        } else {
          // Relative path - resolve from markdown file directory
          resolvedImagePath = path.resolve(
            markdownDir,
            imagePath
          );
        }

        // Check if image file exists
        const imageExists = yield* fs.exists(resolvedImagePath);
        if (!imageExists) {
          yield* Console.log(
            `Warning: Image file not found: ${resolvedImagePath}`
          );
          continue;
        }

        yield* Console.log(`Uploading: ${resolvedImagePath}`);

        // Upload to Cloudinary
        const uploadResult = yield* Effect.tryPromise({
          try: () => {
            return cloudinary.uploader.upload(
              resolvedImagePath,
              {
                resource_type: "auto",
                folder: "ai-hero-images", // Optional: organize uploads in a folder
              }
            );
          },
          catch: (error) => {
            return new ImageUploadError({
              message: `Error uploading ${imagePath}`,
              cause: error,
            });
          },
        });

        // Replace the image reference with the Cloudinary URL
        updatedContent = updatedContent.replace(
          fullMatch,
          `![${altText}](${uploadResult.secure_url})`
        );

        yield* Console.log(
          `✓ Uploaded: ${uploadResult.secure_url}`
        );
      }

      // Write the updated content back to the file
      yield* fs.writeFileString(readmeFile, updatedContent);
    }
  })
).pipe(
  CLICommand.withDescription(
    "Upload images referenced in a markdown file to Cloudinary and replace references with Cloudinary URLs"
  )
);

// cloudinary://<api-key>:<api-secret>@<cloud-name>
const cloudinaryUrlRegex =
  /cloudinary:\/\/([^:]+):([^:]+)@([^:]+)/;

const parseCloudinaryUrl = (url: string) => {
  const match = url.match(cloudinaryUrlRegex);
  if (!match) {
    return Effect.fail(
      new CouldNotParseCloudinaryUrlError({
        message: "Could not parse Cloudinary URL",
      })
    );
  }
  return Effect.succeed({
    apiKey: match[1],
    apiSecret: match[2],
    cloudName: match[3],
  });
};
