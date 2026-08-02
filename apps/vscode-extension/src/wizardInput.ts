import * as vscode from 'vscode';
import { InputStepResult, toInputStepResult } from './wizardStep';
export { InputStepResult, toInputStepResult } from './wizardStep';
export async function promptText(options: vscode.InputBoxOptions): Promise<InputStepResult<string>> { return toInputStepResult(await vscode.window.showInputBox({ ...options, ignoreFocusOut: true })); }
export async function promptPick<T extends vscode.QuickPickItem>(items: readonly T[], options: vscode.QuickPickOptions): Promise<InputStepResult<T>> { return toInputStepResult(await vscode.window.showQuickPick(items, { ...options, ignoreFocusOut: true })); }
