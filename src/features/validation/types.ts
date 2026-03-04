import { Diagnostic } from 'vscode-languageserver/node';
import { URI } from 'vscode-uri';
import { FileReader } from '../../types';
import { ValidationOptions, SeverityOptions } from '../../server/settings';

export interface ValidationResult {
    diagnostics: Diagnostic[];
}

export interface ValidatorOptions {
    /**
     * Base URI for resolving include paths
     */
    baseUri?: URI;

    /**
     * Function to check if files exist
     */
    fileReader?: FileReader;

    /**
     * Validation settings from user configuration
     */
    settings?: {
        validation?: Partial<ValidationOptions>;
        severity?: Partial<SeverityOptions>;
    };
}
