# Elm Plugin for Visual Studio Code (VSCode)

Supports elm 0.19

## Install

1. Install VSCode from [here](https://code.visualstudio.com/)
2. Follow [this link](https://marketplace.visualstudio.com/items?itemName=Elmtooling.elm-ls-vscode) to install the plugin
3. Make sure you have [nodejs](https://nodejs.org/) and therefore npm installed
4. Make sure you have [Elm](https://guide.elm-lang.org/install/elm.html) installed
5. Install elm-test and elm-format by running `npm install -g elm-test elm-format` in a terminal

## Highlighted Features

- Errors and helpful tips will be shown whenever you save a file (Control + S)
- Format on save (Control + S)
- Suggests completions and snippets (Control + Space)

## Additional Features

- Lists all references to a type alias, module, custom type or function (Alt + Shift + F12)
- Jump to the definition of a type alias, module, custom type or function
- Shows type annotations and documentation on hover for type alia, module, custom type or function
- Rename a type alias, module, custom type or function (F2)
- Browse file by symbols (Control + Shift + O)
- Browse workspace by symbols (Control + Shift + R)
- Codelenses show how many times you calling a function and if it's exposed or not
- Code folding

## Extension Settings

This extension contributes the following settings:

- `elmLS.trace.server`: Enable/disable trace logging of client and server communication
- `elmLS.elmPath`: The path to your elm executable.
- `elmLS.elmFormatPath`: The path to your elm-format executable.
- `elmLS.elmTestPath`: The path to your elm-test executable.
- `elmLS.elmAnalyseTrigger`: When do you want the extension to run elm-analyse? Might need a restart to take effect.

## FAQ

- Most features don't seem to work for me?

  - This tool needs a valid elm project, please check if you have an `elm.json`. You can easily initialize your project with `elm init`. If it still does work, please try if you get the same behavior with the [elm-spa-example](https://github.com/rtfeldman/elm-spa-example/).

- What's the relation to the language server?

  - This [vscode extension](https://marketplace.visualstudio.com/items?itemName=Elmtooling.elm-ls-vscode) is including the [elm-language-server](https://github.com/elm-tooling/elm-language-server) which enables most of the used features.

- Why do I need to install `elm`, `elm-test` and `elm-format`?

  - You will need to install `elm` and `elm-test` to get all diagnostics and `elm-format` for formatting. If your setup fails to find the global installations of those, you can use the settings panel in VSCode to set the paths to the executable manually. Alternatively you can also just install these to your local npm `package.json`.

- Can I use an `elm-analyse` config?

  - Yes, you can, please check [here](https://github.com/elm-tooling/elm-language-server/blob/master/README.md#elm-analyse-configuration) for more details.

## Contributing / Debugging

```shell
git clone --recursive git@github.com:elm-tooling/elm-language-client-vscode.git
cd elm-language-client-vscode
npm install
```

Open VSCode with this project (`code .`) and press `F5` to start debugging the plugin.
