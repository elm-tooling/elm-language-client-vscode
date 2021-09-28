# Elm Plugin for Visual Studio Code (VSCode)

[![Version](https://vsmarketplacebadge.apphb.com/version/Elmtooling.elm-ls-vscode.png)](https://marketplace.visualstudio.com/items?itemName=Elmtooling.elm-ls-vscode)
[![Downloads](https://vsmarketplacebadge.apphb.com/downloads-short/Elmtooling.elm-ls-vscode.png)](https://marketplace.visualstudio.com/items?itemName=Elmtooling.elm-ls-vscode)
[![Rating](https://vsmarketplacebadge.apphb.com/rating-star/Elmtooling.elm-ls-vscode.png)](https://marketplace.visualstudio.com/items?itemName=Elmtooling.elm-ls-vscode)

Supports elm 0.19 and up

## Install

1. Install VSCode from [here](https://code.visualstudio.com/)
2. Follow [this link](https://marketplace.visualstudio.com/items?itemName=Elmtooling.elm-ls-vscode) to install the plugin
3. Make sure you have [nodejs](https://nodejs.org/) and therefore npm installed
4. Make sure you have [Elm](https://guide.elm-lang.org/install/elm.html) installed
5. Install `elm-test` and `elm-format` by running `npm install -g elm-test elm-format` in a terminal
6. (Optional) Install `elm-review` via `npm install -g elm-review` in a terminal and enable it in your settings

## Highlighted Features

- Errors and informations when changing code and when saving (Control + S)
- Format on save (Control + S) (Make sure you also enable the "Editor: Format on Save" setting for this to work).
- Suggests completions and snippets (Control + Space)
- Test explorer integration

## Additional Features

- Lists all references to a type alias, module, custom type or function (Alt + Shift + F12)
- Jump to the definition of a type alias, module, custom type or function
- Shows type annotations and documentation on hover for type alias, module, custom type or function
- Rename a type alias, module, custom type or function (F2)
- Browse file by symbols (Control + Shift + O)
- Browse workspace by symbols (Control + Shift + R)
- Codelenses show how many times you calling a function and if it's exposed or not
- Code folding
- Type inference
- Some more

## Extension Settings

This extension contributes the following settings:

- `elmLS.trace.server`: Enable/disable trace logging of client and server communication
- `elmLS.elmPath`: The path to your elm executable.
- `elmLS.elmReviewPath`: The path to your elm-review executable.
- `elmLS.elmReviewDiagnostics`: Configure linting diagnostics from elm-review. Possible values: `off`, `warning`, `error`.
- `elmLS.elmFormatPath`: The path to your elm-format executable.
- `elmLS.elmTestPath`: The path to your elm-test executable.
- `elmLS.disableElmLSDiagnostics`: Disable linting diagnostics from the language server.
- `elmLS.skipInstallPackageConfirmation`: Skip confirmation for the Install Package code action.
- `elmLS.onlyUpdateDiagnosticsOnSave`: Only update compiler diagnostics on save, not on document change.
- `elmLS.elmTestRunner.showElmTestOutput`: Show output of elm-test as terminal task.

## Configuration

We used to have a file called `elm-tooling.json` where you could specifiy `"entrypoints"`. That’s not needed anymore – the language server finds the entrypoints automatically.

If all you had in `elm-tooling.json` was `"entrypoints"`, you can safely remove that file.

## FAQ

- How to get a logfile?

  - `F1` -> Type `Output: Focus on Output View` -> In the now open panel, use the drop down on the right to choose `Elm (your project name)`

- Most features don't seem to work for me?

  - This tool needs a valid elm project, please check if you have an `elm.json`. You can easily initialize your project with `elm init`. If it still does work, please try if you get the same behavior with the [elm-spa-example](https://github.com/rtfeldman/elm-spa-example/).

- What's the relation to the language server?

  - This [vscode extension](https://marketplace.visualstudio.com/items?itemName=Elmtooling.elm-ls-vscode) is including the [elm-language-server](https://github.com/elm-tooling/elm-language-server) which enables most of the used features.

- Why do I need to install `elm`, `elm-test` and `elm-format`?

  - You will need to install `elm` and `elm-test` to get all diagnostics and `elm-format` for formatting. If your setup fails to find the global installations of those, you can use the settings panel in VSCode to set the paths to the executable manually. Alternatively you can also just install these to your local npm `package.json`.

- I don't like the inserted lines for "X references" (CodeLenses)

  - You can configure VSCode to not show them, just look for "Editor: Code Lens" in your settings.

- I'm using glsl and the extension is not helpful

  - You need to additionally install [vscode-glsllint](https://github.com/hsimpson/vscode-glsllint)

## Contributing / Debugging

```shell
git clone --recursive git@github.com:elm-tooling/elm-language-client-vscode.git
cd elm-language-client-vscode
npm install
```

Open VSCode with this project (`code .`) and press `F5` to start debugging the plugin.
