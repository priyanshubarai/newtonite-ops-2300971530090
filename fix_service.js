const fs = require('fs');
const content = fs.readFileSync('E:/newtonite assignment/backend/src/items/service.ts', 'utf8');

const old = `/**
 * Fetch one work item, authorizing against its real team.
 *
 * A missing item and an out-of-scope item both return 404 so a caller cannot
 * tell "exists but forbidden" from "does not exist" (no cross-team
 * enumeration).
 */
  const row = await findWorkItemById(id);`;

const newStr = `/**
 * Fetch one work item, authorizing against its real team.
 *
 * A missing item and an out-of-scope item both return 404 so a caller cannot
 * tell "exists but forbidden" from "does not exist" (no cross-team
 * enumeration).
 */
export async function getItem(userId: string, id: string): Promise<WorkItemResponse> {
  const row = await findWorkItemById(id);`;

const newContent = content.replace(old, newStr);
fs.writeFileSync('E:/newtonite assignment/backend/src/items/service.ts', newContent);
console.log('Done');