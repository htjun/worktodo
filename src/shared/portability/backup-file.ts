import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, fsyncSync, linkSync, openSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { PortabilityError } from "./backup-contract";

export const WORKTODO_MAX_BACKUP_BYTES = 100 * 1024 * 1024;

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function removeCandidate(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      return;
    }
  }
}

function closeCandidate(descriptor: number): void {
  try {
    closeSync(descriptor);
  } catch {
    return;
  }
}

export function assertBackupSize(contents: string, maximumBytes = WORKTODO_MAX_BACKUP_BYTES): void {
  if (Buffer.byteLength(contents, "utf8") > maximumBytes) {
    throw new PortabilityError("FILE_TOO_LARGE", "The Worktodo backup exceeds the 100 MiB limit.");
  }
}

export function publishBackupFile(directory: string, filename: string, contents: string): string {
  if (!isAbsolute(directory) || basename(filename) !== filename || !filename.endsWith(".json")) {
    throw new PortabilityError("INVALID_DESTINATION", "Choose an existing folder for the Worktodo backup.");
  }

  try {
    if (!statSync(directory).isDirectory()) {
      throw new Error("Destination is not a directory");
    }
  } catch (error) {
    throw new PortabilityError("INVALID_DESTINATION", "Choose an existing folder for the Worktodo backup.", error);
  }

  assertBackupSize(contents);
  const destination = join(directory, filename);
  const candidate = join(directory, `.${filename}.${randomUUID()}.tmp`);
  let descriptor: number | undefined;

  try {
    descriptor = openSync(candidate, "wx", 0o600);
    chmodSync(candidate, 0o600);
    writeFileSync(descriptor, contents, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    linkSync(candidate, destination);
  } catch (error) {
    if (descriptor !== undefined) {
      closeCandidate(descriptor);
    }
    removeCandidate(candidate);
    if (errorCode(error) === "EEXIST") {
      throw new PortabilityError("DESTINATION_EXISTS", "A backup with this name already exists.", error);
    }
    throw new PortabilityError("FILE_WRITE_FAILED", "Worktodo could not write the backup file.", error);
  }

  removeCandidate(candidate);
  return destination;
}
