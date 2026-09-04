import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('benchSample.hello', () => {
      vscode.window.showInformationMessage('Hello from Bench Sample Extension');
    })
  );
}

export function deactivate() {}
