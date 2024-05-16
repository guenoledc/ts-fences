export interface ProjectStructureLayer {
    name: string;
    files: string[];
    allowImports: string[];
}
export interface ProjectStructureConfig {
    layers: ProjectStructureLayer[];
    exclude?: string[];
}
export interface ImportDiagnostic {
    source: string;
    imported: string;
    allowed: string[];
    forbidden: string[];
    diagnosticText: string;
}
export interface FileRef {
    name: string;
    imported: string[];
    layers: string[];
    diagnostics?: ImportDiagnostic[];
}
export declare function checkProjectStructure(basePath: string): ImportDiagnostic[];
