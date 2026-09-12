# Agentic UI integration

Source: https://github.com/piyushxpj/agentic-ui
The complete component library, support utilities, local fonts, and public assets are vendored locally under the original MIT license. Imports and asset URLs are adapted to this app. Tokens and typography helpers are scoped to `.agentic-theme` across the shared application shell.

The Markets page uses Button, Input, Select, TabGroup/Tab, NavLink/NavSection, Icon, and ProgressBar. Its semantic HTML table follows the repository table showcase; the source has no reusable Table component. Launch and detail screens also use Field, Label, Fieldset, Legend, Textarea and shared segmented controls. The full library remains available for further iterations.

Source revision: `4cbf421c93f201e627145092699048279da7fc24`.

Integration fixes: arrow-key/Home/End navigation in TabGroup, and type-safe variant narrowing in support/lib/motionHooks.ts. The original dependency graph is preserved; only motion and its three dependencies were added.
