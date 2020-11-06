# Change Log

## 1.5.3

- Updated the language server
	- Fix bug on file open
	- Fix some type inference bugs
	- Reset diagnostics for elmMake and elmAnalyze

## 1.5.2

- No changes

## 1.5.1

- No changes

## 1.5.0

- Updated the language server	
	- Debounce sending diagnostics to the client
	- Support finding field references and renaming
	- Tree sitter parser improvements
	- Handle negate expressions in type inference

## 1.4.1

- Updated the language server
	- Fixed hovers for functions not showing up
	- Fixed hovers for let definitions not showing if they have no type annotation
	- Fixed a problem with node 10

## 1.4.0

- Elm-Analyse will be disabled by default from now on
- Added elm-tooling.json schema for better integration
- Updated dependencies

- Updated the language server	
	- Make entrypoints configurable via elm-tooling.json
	- Default elmAnalyseTrigger to never
	- Added type inference
	- Added type inference diagnostics for missing top level type annotations
	- Added codeActions to infer annotations for functions
	- Added goto definition and references for ports
	- Create function declaration from usage
	- More goto definition improvements
	- Tree sitter now parses the files incrementally after the initial scan

## 1.3.0

- Prefill newly create elm files
- Renaming files in the file explorer will rename tho module definition
- Cache codelens requests to prevent duplicate server requests

- Updated the language server	
	- Improve definition for conflicting module/type names
	- Various completion sorting tweaks
	- Add parameter names to hovers/autocompletions for functions
	- Improve module renames to also rename the file
	- Add support renaming files in the vscode file explorer
	- Use dependency injection to resolve classes

## 1.2.0

- Fixed names with "_" being highlighted wrong
- Updated dependencies

- Updated the language server
	- Add value completions for non-imported modules
	- Add definition handling for type variables
	- Improved annotation/function name completions
	- Various other completion improvements
	- Fixed wrong wildcard shadowing rules
	- Update tree sitter and other dependencies

## 1.1.1

- Updated the language server
	- Revert "We changed the used globbing lib to a slightly faster one"

## 1.1.0

- Updated the language server
	- We changed the used globbing lib to a slightly faster one
	- Improved sorting of autoimport completions
	- Don't complete in comments
	- Separate snippets and keywords by type and show them in different circumstances
	- Added completions for module values or possible submodules
	- Added function completion for used but not declared function
	- Fix for possible exception on completion
	- Fix external modules not being found in some cases
	- Fix record completions interfering with Module completions

## 1.0.3

- Updated the language server
	- Fixed bug that was causing problems with completions from external packages

## 1.0.2

- Updated the language server
	- Fix problem on import generation for windows systems

## 1.0.1

- Updated the language server
	- Fix imports form other files not showing up in some cases

## 1.0.0

- Added restart command
- Make elm.json schema stricter
- Update dependencies

- Updated the language server
	- Add completions for possible imports
	- Scaffold case branches (use the new snippet and code action)
	- Sort auto imports by closest similar modules
	- Improve record field access completions
	- Remove exposing subscriptions in Browser.sandbox snippet
	- Fixed references to shadowed modules being potentially wrong
	- Don't use flatmap to be node 10 compatible (caused problems for npm package users)
	- Update elm-analyse
	- Update dependencies

## 0.10.2

- Updated the language server
	- Add record access completions for types and nested types
	- Fix elm.json being ignored when paths are similar to another
	- Fix record field jump to definitions 
	- Fix record field completions in some cases
	- Fix auto import not suggesting modules with multiple prefixes
	- Fix error where qualified names were not taken into account for definition resolving
	- Updated package rankings

## 0.10.1

- Updated the language server
	- Fix exposing list params not getting completed for imports
	- Fix possible imports for packages not in ranking list
	- Prevent imports from getting out of date

## 0.10.0

- Fix case where type constructor highlighting was wrong
- Client support for codeLens exposing/unexposing and move function refactoring

- Updated the language server
	- Add diagnostic on unknown symbols and offer importing via codeAction (needs the file to be save and the compiler to run)
	- Support exposing/unexposing functions and types via codeLense or codeAction
	- Add support for move function refactoring
	- Fix init taking long when using files with thousands of functions
	- Add new snippet for if-else conditions
	- Better completions for record update syntax
	- Added completions for basic keywords like if, then, else, let etc.
	- Improved hovers for types aliases
	- Added jump to definition for fields of records
	- Better handling of invalid renames

## 0.9.4

- Updated the language server
	- Improved goto definition, find references and rename for anonymous functions, let definitions, destructured functions in let definitions, destructured parameters and case branches
	- Show comment from type for type constructor

## 0.9.3

- Improve auto closing and surrounding pairs some more
- Align char syntax highlighting to recommended namespace

- Updated the language server
	- Fade unused symbols
	- Improved some codeAction texts

## 0.9.2

- Raised minimal vscode version

## 0.9.1

- Fix problem with formatting

## 0.9.0

- Added support for new language server features
- Add syntax highlighting for hexadecimal constants
- Add /= to syntax highlighting

- Updated the language server
	- Add selection range handling
	- Add progress indicator for startup
	- Improved package ratings
	- Remove deleted files from diagnostics
	- Fix errors that could happen on startup
	- Fix interactions not working after ( or similar characters

## 0.8.0

- Syntax highlighting fixes for comments and some other corner cases
- Add multiline string syntax to auto closing pairs

- Update the language server
	- Add support for multiple elm.json files in a single project directory tree
	- Fix possible issue with server not recognising files in non-normalized
		source-directories (containing "..").
	- Completions are now ranked better
	- Show code for types in completions/hovers
	- Fix elm analyse warnings not getting cleaned up correctly

## 0.7.4

- Improve type alias and type highlighting for some cases

- Update the language server
	- Fix type annotations not showing for local parameters
	- Fix files without module declaration not getting added to our index
	- Fix rename devouring Module prefixes

## 0.7.3

- Fix a case of wrong highlighting 

- Update the language server
	- Improved completions for type annotations, functions, import and module statements
	- Fixed a bug where files without imports would not index the virtual imports

## 0.7.2

- Update `elm.json` schema to allow `0.19.1` as a version
- Renamed extension from `ElmLS` to `Elm`

- Updated the language server
	- Add more feedback on init for common errors 
	- Make sure a file without permissions doesn't crash the server
	- `-v` to print version was not working

## 0.7.1

- Updated the language server
	- Remove completions committing when space is pressed

## 0.7.0

- Made elm.json schema completions better and more helpful
- Fixed '"' breaking syntax highlighting

- Updated the language server
	- Completions should be much nicer to use now
	- Improved performance for codeLenses
	- Do not crash when the elm compiler generates invalid json
	- Fix codeLens bug showing wrong count for types
	- Print version with `-v` or `--version`


## 0.6.0

- Reference code lenses are now clickable, try it!

- Updated the language server
	- Add elm make code actions for more compiler errors
	- Various improvements to folding
	- Process files on init in parallel
	- Fixed some problems with references not being correct
	- Fallback to old configuration flow when clients don't support the new one
	- Get rid of crypto deprecation warnings

	- Updated tree-sitter syntax parsing
		- Add glsl parsing
		- Nest if/then/else expressions
		- Let and in now correctly nest
		- Change when block_comments are set, should now be better for annotations
		- End functions/case as early as possible, so they don't include whitespace

## 0.5.2

- Updated the language server
	- Fixed case where elm-format might have stripped the last line from you files

## 0.5.1

- Fixed missing dependency on startup
- Updated the language server
	- Fix problem on init on windows systems

## 0.5.0

- Added commands for installing and browsing Elm packages
- Change extension icon
- Updated the language server
	- Updated and clarified the readme in multiple ways, also added sublime text instructions
	- Reworked settings and detection of `elm`, `elm-test` and `elm-format`
	- Server figures out the elm version automatically
	- Correctly detect cursors on or after the last character of a token
	- elm.json detection is now handled by the server, the setting is deprecated
	- Handle elm libraries better, we failed to load the correct deps before this
	- You can configure when to run elm-analyse via the setting `elmAnalyseTrigger` ("change" | "save" | "never")
	- Some cleanups for cases where the elm compiler does not respond with a json


## 0.4.2

- Updated the language server
	- Fixed document changes causing high cpu load
	- Included a fix for a memory out of bounds error that could occur
	- Removed `runtime` option, that is now unneeded due to us using wasm
	- Use normal file path rather than file:// protocol when reading a file

## 0.4.1

- Revert determination of used elm compiler version, as it was causing file open to go unnoticed

## 0.4.0

- Updated the language server
	- Use WASM version of tree-sitter and updated tree-sitter - This mean multiple parsing improvements
	- Added completions for methods defined in a let scope
	- Added completions from case branches
	- Added code actions for some rename suggestions from elm make
	- Removed the ability to run elm-test for now, as it was problematic
	- Determine the used elm version, so that we're ready for 0.19.1
	- Cleaned up the symbols that we show in the outline or when searching
	- Fixed multiple problems with multi workspace useage
	- Fixed type references including (..) on search or rename
	- Fixed elm make not reporting the correct path in some edgecases
- Don't reveal the output channel on each log
- Better names for output channels in multi workspace projects

## 0.3.0

- Initial release
