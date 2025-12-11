import { WorkspaceManager } from '../../src/server/workspace';
import { HledgerParser } from '../../src/parser';
import { FileReader } from '../../src/types';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Connection } from 'vscode-languageserver/node';
import { URI } from 'vscode-uri';
import * as path from 'path';

// Mock the Connection interface
const mockConnection = {
    console: {
        log: jest.fn(),
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn()
    }
} as unknown as Connection;

// Mock fast-glob
jest.mock('fast-glob', () => {
    const mockFn = jest.fn((patterns: string[], options: any) => {
        const cwd = options?.cwd || '';
        if (cwd.includes('Special Characters (2025)')) {
            // These would be the actual file paths on disk (not encoded)
            return Promise.resolve([
                `${cwd}/main.journal`,
                `${cwd}/patrick@email.com/week.journal`
            ]);
        }
        return Promise.resolve([]);
    });

    // Add sync method for resolveIncludePath logic if needed
    (mockFn as any).sync = jest.fn(() => []);

    return mockFn;
});

// Mock configFile
jest.mock('../../src/server/configFile', () => ({
    discoverConfigFile: jest.fn(),
    loadConfigFile: jest.fn(),
    resolveRootFile: jest.fn(),
    mergeConfig: (config: any) => config
}));

describe('WorkspaceManager URI Encoding', () => {
    let manager: WorkspaceManager;
    let parser: HledgerParser;
    let fileReader: FileReader;

    beforeEach(() => {
        manager = new WorkspaceManager();
        parser = new HledgerParser();
        jest.clearAllMocks();

        fileReader = (uri: URI): TextDocument | null => {
            // Simple mock reading
            if (uri.toString().endsWith('main.journal')) {
                return TextDocument.create(uri.toString(), 'hledger', 1, 'include patrick@email.com/week.journal');
            }
            if (uri.toString().endsWith('week.journal')) {
                return TextDocument.create(uri.toString(), 'hledger', 1, '2025-01-01 * Test');
            }
            return null;
        };
    });

    test('should handle encoded URIs from client finding root for file', async () => {
        // Setup:
        // Path on disk: /home/user/Special Characters (2025)/patrick@email.com/week.journal
        // URI reported by discoverJournalFiles (internal): file:///home/user/Special Characters (2025)/patrick@email.com/week.journal
        //   (Note: toFileUri in this codebase currently does NOT key-encode many chars like @ or space unless strictly required, 
        //    but let's verify exact behavior. Actually, the issue description says VSCode sends encoded URIs)

        // Let's mimic the folder path from the user's issue:
        // /home/patrick/Insync/patrick.timoney@gmail.com/Google Drive/Joint Finances (2025)/...

        const rootDir = '/home/user/Special Characters (2025)';
        const rootUri = URI.file(rootDir); // Use URI.file to properly create URI

        await manager.initialize(
            [rootUri],
            parser,
            fileReader,
            mockConnection
        );

        // Verify main.journal was found and set as root
        const diagnostics = manager.getDiagnosticInfo();
        // The main journal internal URI
        const mainJournalUri = URI.file(`${rootDir}/main.journal`);

        // If the internal discovery works, it should have found the files.
        // However, the issue is about looking up a file with an ENCODED uri.

        // VSCode sends this for a file open:
        // percentage encoded spaces, parenthesis, @
        // file:///home/user/Special%20Characters%20%282025%29/patrick%40email.com/week.journal
        const clientSentUriString = 'file:///home/user/Special%20Characters%20%282025%29/patrick%40email.com/week.journal';
        const clientSentUri = URI.parse(clientSentUriString);

        // This look up should succeed if we normalize correctly.
        const root = manager.getRootForFile(clientSentUri);

        // This look up should succeed if we normalize correctly.
        // Use toFileUri to get the expected internal format (spaces encoded, parens not)
        // We can import toFileUri from the source, but for this test we can just hardcode what we saw 
        // or rely on the fact that the manager uses it.
        // Received: "file:///home/user/Special%20Characters%20(2025)/main.journal"
        // This is the correct internal representation.
        const expectedRootUri = URI.file(`${rootDir}/main.journal`);

        expect(root?.toString()).toBe(expectedRootUri.toString());
    });
});
