import { URI } from "vscode-uri";
import { FileReader } from "../types";
import { toFilePath } from "./uri";
import * as fs from 'fs';
import { TextDocument } from "vscode-languageserver-textdocument";

export function readDocument(fileUri: URI, fileReader?: FileReader,): TextDocument {
  // Get the TextDocument for this URI
  let doc: TextDocument | null = null;
  if (fileReader) {
    doc = fileReader(fileUri);
  }

  if (!doc) {
    // Fallback to reading from disk
    const filePath = toFilePath(fileUri);
    const content = fs.readFileSync(filePath, 'utf8');
    doc = TextDocument.create(fileUri.toString(), 'hledger', 1, content);
  }
  return doc


}

export function readDocumentLines(fileUri: URI, fileReader?: FileReader,): string[] | null {
  // Get file lines for finding character positions
  let lines: string[] | null = null;
  if (fileReader) {
    const doc = fileReader(fileUri);
    if (doc) {
      lines = doc.getText().split('\n');
    }
  }
  if (!lines) {
    try {
      const filePath = toFilePath(fileUri);
      const content = fs.readFileSync(filePath, 'utf8');
      lines = content.split('\n');
    } catch (error) {
      return null;
    }
  }
  return lines

}
