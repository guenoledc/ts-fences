
import { checkProjectStructure } from "./index.js";

const basePath = process.argv[2] || process.cwd();
const diagnostics = checkProjectStructure(basePath);
if (diagnostics.length === 0) {
    console.log("Project structure is correct.");
} else {
    console.log("Diagnostics:\n" + diagnostics.map(d=>d.diagnosticText).join("\n"));
    process.exit(1);
}


export default {};