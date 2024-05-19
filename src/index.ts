import ts from "typescript"
import GlobToRegExp from "glob-to-regexp";
import fs from "node:fs";
import path from "node:path";


export interface ProjectStructureLayer {
  // name: string;
  files: string[];
  allowImports?: string[];
  exports?: string [];
}

export interface ProjectStructureConfig {
  layers: {[name:string]: ProjectStructureLayer};
  exclude?: string[];
  traceFile?: string;
  ignoreCycles?: boolean;
}

export enum ImportDiagnosticCode {
  IMPORT_NOT_EXPORTED = "NOT_EXPORTED",
  IMPORT_FROM_FORBIDDEN_LAYER = "FORBIDDEN_LAYER",
  CYCLE_DETECTED = "CYCLE_DETECTED"
}
export interface ImportDiagnostic {
  code: ImportDiagnosticCode
  source: string;
  imported: string;
  allowed: string[];
  forbidden: string[];
  diagnosticText: string;
}

export interface FileRef {
  name: string;
  imported: string[];
  exported: boolean;
  layers: string[];
  diagnostics?: ImportDiagnostic[];
  cyclical?: boolean;
}

function createParseConfigHost(): ts.ParseConfigHost {
  const h = ts.createCompilerHost({});
  return {
    ...h,
    readDirectory: h.readDirectory!,
    useCaseSensitiveFileNames: h.useCaseSensitiveFileNames()
  }
}


interface CompilerHostWithFileCollection extends ts.CompilerHost {
  files: Map<string, FileRef>
}

function createCompilerHostWithFileCollection(opt: ts.CompilerOptions): CompilerHostWithFileCollection {
  const host = ts.createCompilerHost(opt);
  const fileMap = new Map<string, FileRef>();
  const resolveModuleNameLiterals = (moduleLiterals: readonly ts.StringLiteralLike[], containingFile: string, redirectedReference: ts.ResolvedProjectReference | undefined, options: ts.CompilerOptions, containingSourceFile: ts.SourceFile, reusedNames: readonly ts.StringLiteralLike[] | undefined): readonly ts.ResolvedModuleWithFailedLookupLocations[] => {
    fileMap.has(containingFile) || fileMap.set(containingFile, {imported: [], name: containingFile, layers: [], exported: true});
    const fileRef = fileMap.get(containingFile)!;
    const res: ts.ResolvedModuleWithFailedLookupLocations[] = [];
    // if (host.resolveModuleNameLiterals) {
    //   res.push( ...host.resolveModuleNameLiterals(moduleLiterals, containingFile, redirectedReference, options, containingSourceFile, reusedNames) );
    //   for(let i=0; i<moduleLiterals.length; i++) {
    //     console.log("Resolved:", moduleLiterals[i].text, "in", containingFile, "==>", res[i].resolvedModule?.resolvedFileName);
    //   }
      
    // } else {
      for(const m of moduleLiterals) {
        let r: ts.ResolvedModuleWithFailedLookupLocations;
        r=ts.resolveModuleName(m.text, containingFile, options, host, undefined, redirectedReference )
        // console.log("resolved:", m.text, "in", containingFile, "==>", r.resolvedModule?.resolvedFileName);
        if (r.resolvedModule) {
          const importedFile = r.resolvedModule.resolvedFileName;
          if (!fileRef.imported.includes(importedFile)) {
            fileRef.imported.push(importedFile);
            fileMap.has(importedFile) || fileMap.set(importedFile, {imported: [], name: importedFile, layers: [], exported: true});
          }
        } else {
          if (!fileRef.imported.includes(m.text)) {
            fileRef.imported.push(m.text);
          }
          // fileMap.has(m.text) || fileMap.set(m.text, {imported: [], name: m.text, layers: []});
        }
        res.push(r);
      }
    // }
    return res;
  }
  return {
    ...host,
    resolveModuleNameLiterals,
    files: fileMap
  }
  
}

/** convert an absolute path into a relative file based on the current working directory */
function rel(file: string) {
  if (path.isAbsolute(file)) return path.relative(process.cwd(), file);
  else return file;
}

// create a function that finds the package.json in the current folder or the folders below
function findPackageJson(fromDir?: string): string | undefined {
  const currentDir = fromDir||process.cwd();

  let dir = currentDir;
  while (dir !== "/") {
    const packageJsonPath = path.join(dir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      return packageJsonPath;
    }
    dir = path.dirname(dir);
  }

  return undefined;
}

function loadStructureConfig(path: string): ProjectStructureConfig|undefined {
  const pkgJson = findPackageJson(path);
  // console.log("Found package.json", pkgJson);
  // extract the field "structure" from the package.json as a js object
  if (pkgJson) {
    const packageJsonContent = fs.readFileSync(pkgJson, "utf-8");
    const packageJson = JSON.parse(packageJsonContent);
    return packageJson.structure;
  }
  return undefined;
}

function loadProjectConfig(path?: string) {
  const basePath = path || process.cwd();
  const hostForConfig = createParseConfigHost();
  const configFileName = ts.findConfigFile(basePath, hostForConfig.fileExists);
  if (!configFileName) throw new Error("No config file found");
  const configContent = hostForConfig.readFile(configFileName);
  if (!configContent) throw new Error("Cannot read the content of " + configFileName);
  const configSourceFile: ts.TsConfigSourceFile = ts.parseJsonText(configFileName, configContent);
  const parsedCmdLine = ts.parseJsonSourceFileConfigFileContent(configSourceFile, hostForConfig, basePath, undefined, configFileName);
  return parsedCmdLine;
}


function filterExclusion(fileMap:Map<string, FileRef>, config: ProjectStructureConfig) {
  // create the exclude regexes created with the global flag and global flag removed so it tests the whole string once
  const excludeRe = (config.exclude || ["node_modules"]).map(e => GlobToRegExp(e, { extended: false, globstar: true, flags: "g" })).map(re => new RegExp(re.source, ""));
  // we want to exclude all files that match any of the exclude patterns
  const files = Array.from(fileMap.keys()).filter(f => !excludeRe.some(re => re.test(f)));
  return files;
}



function setFileLayers(files: string[], map: Map<string, FileRef>, config: ProjectStructureConfig) {
  // parse the files to tag the layer
  for(const f of files) {
    const fileRef = map.get(f)!;
    let exported: boolean|undefined = undefined;
    for(const layerName in config.layers) {
      const layer = config.layers[layerName];
      if ( layer.files.some(p=>GlobToRegExp(`**/${p}`, {extended: true, globstar: true}).test(f)) ) {
        fileRef.layers.push(layerName);
        if (layer.exports) {
          exported = layer.exports.some(p=>GlobToRegExp(`**/${p}`, {extended: true, globstar: true}).test(f));
        }
      }
    }
    if (exported === undefined) fileRef.exported = true;
    else fileRef.exported = exported;
    // console.log("File", f, "is in layers", fileRef.layers, "exported", fileRef.exported, "<==",exported);
    
  }
}


function detectCycles(map: Map<string, FileRef>, file: string, visited: Map<string, boolean>): string[] {
  
  // we have reached a file that has already been visited
  if (visited.has(file) && visited.get(file)) {
    return [file];
  }
  
  const fileRef = map.get(file);
    
  // file not in the map, we cannot go further in the search
  if (!fileRef) return [];
  
  // if the file is already classified as cyclical or not, we can stop the search
  if (fileRef.cyclical !== undefined) return [];

  visited.set(file, true);
  // loop in the dependencies
  for(const imported of fileRef.imported) {
    const cycles = detectCycles(map, imported, visited);
    if (cycles.length>0) {
      if (file === cycles[cycles.length-1]) {
        fileRef.cyclical = true;
        fileRef.diagnostics || (fileRef.diagnostics = []);
        fileRef.diagnostics.push({
          code: ImportDiagnosticCode.CYCLE_DETECTED,
          source: rel(file), imported: "", allowed: [], forbidden: [],
          diagnosticText: `Cycle detected in imports: ${[rel(file), ...cycles.map(f=>rel(f))].join(" <= ")}`
        });
        return []; // cycle detected, stop the search
      } else return [file, ...cycles]; // propagate the cycle
    }
  }
  visited.set(file, false);
  fileRef.cyclical = false;
  return [];
}

function checkImportCompliance(files: string[], map:Map<string, FileRef>, config: ProjectStructureConfig ) {
  
  // parse the files to check the imports
  for(const f of files) {
    const fileRef = map.get(f)!;
    // if (fileRef.layers.length === 0) continue; // no layer for this file, no need to check the imports
    // check the imported files and modules
    for(const imported of fileRef.imported) {
      const importedRef = map.get(imported);
      if (!importedRef) continue;

      // if the imported file is in the same layer, skip the control
      if (fileRef.layers.some(l=>importedRef.layers.includes(l))) continue;

      // the imported file must have been exported
      if (!importedRef.exported ) {
        // console.log("Forbidden import", f, "imports", imported, "which is not exported");
        fileRef.diagnostics || (fileRef.diagnostics = []);
        fileRef.diagnostics.push({
          code: ImportDiagnosticCode.IMPORT_NOT_EXPORTED,
          source: rel(f), imported: rel(imported), allowed: [], forbidden: [],
          diagnosticText: `"${rel(f)}" imports "${rel(imported)}" which is not exported`
        });
        // continue;
      }

      // the layers of the imported file must be allowed by the current file
      // if the file tested has not been put in a layer then it can import anything
      if (fileRef.layers.length > 0) {
        const importedLayers = importedRef.layers;
        const allowedLayers = fileRef.layers.map(l=>config.layers[l]).flatMap(l=>l.allowImports||[]);
        allowedLayers.push(...fileRef.layers); // a file can import from its own layer
        const forbiddenLayers = importedLayers.filter(l=>!allowedLayers.includes(l));
        if (forbiddenLayers.length>0) {
          // console.log("Forbidden import", f, "imports", imported, importedLayers, "from layers", allowedLayers, "forbidden layers", forbiddenLayers);
          fileRef.diagnostics || (fileRef.diagnostics = []);
          fileRef.diagnostics.push({
            code: ImportDiagnosticCode.IMPORT_FROM_FORBIDDEN_LAYER,
            source: rel(f), imported: rel(f), allowed: allowedLayers, forbidden: forbiddenLayers,
            diagnosticText: `"${rel(f)}" (layer: ${fileRef.layers.join(', ')}) imports "${rel(imported)}" (layer: ${importedLayers.join(', ')}). Layer(s) ${forbiddenLayers.join(', ')} not allowed. Only import from ${allowedLayers.join(', ')}`
          });
        } 
        // else {
        //   console.log("Allowed import", f, "imports", imported);
        // }
      }
    }

    // check for cycles
    if (!config.ignoreCycles) {
      detectCycles(map, f, new Map<string, boolean>());
    }
  }

}

function getDiagnostics(map: Map<string, FileRef>, config: ProjectStructureConfig ): ImportDiagnostic[] {
  const files = filterExclusion(map, config);
  return files.map(f=>map.get(f)!).filter(f => f!.diagnostics).flatMap(f => f!.diagnostics).filter(d => d) as any;
}

// const conf: ProjectStructureConfig = {
//   layers: [
//     {
//       name: "domain",
//       files: ["src/domain/*.ts"],
//       allowImports: []
//     },
//     {
//       name: "business",
//       files: ["src/business/*.ts"],
//       allowImports: ["domainx"]
//     },
//     {
//       name: "root",
//       files: ["src/index.ts"],
//       allowImports: ["business", "domain"]
//     }
//   ],
//   exclude: ["node_modules", "*.d.ts"]
// }


export function checkProjectStructure(basePath: string) {
  
  const parsedCmdLine = loadProjectConfig(basePath);

  let structureConfig = loadStructureConfig(basePath);
  if (!structureConfig) { // make a default config
    console.warn("WARN: No structure config found in package.json. Using a default one. You should add a 'structure' field in your package.json following type ProjectStructureConfig.");
    structureConfig = {
      layers: {}
    }
  }

  const host = createCompilerHostWithFileCollection(parsedCmdLine.options);
  // run the compilation of the files, filling host.files
  ts.createProgram({
    rootNames: parsedCmdLine.fileNames,
    options: parsedCmdLine.options,
    host
  })


  const fileMap = host.files;

  const files = filterExclusion(fileMap, structureConfig);
  setFileLayers(files, fileMap, structureConfig);
  checkImportCompliance(files, fileMap, structureConfig);

  if (structureConfig.traceFile) {
    // save the fileMap to a file for debugging
    fs.writeFileSync(structureConfig.traceFile, JSON.stringify(Object.fromEntries(Array.from(fileMap.entries()).filter(([key, value])=>!key.includes("node_modules")).sort((a,b)=>a[0]==b[0]?0:(a[0]<b[0]?-1:1))), null, 2));
    // fs.writeFileSync("fileMap.json", JSON.stringify(Object.fromEntries(Array.from(fileMap.entries()).sort((a,b)=>a[0]==b[0]?0:(a[0]<b[0]?-1:1))), null, 2));
  }
  return getDiagnostics(fileMap, structureConfig);
}
