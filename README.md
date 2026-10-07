# RepoVisualizer

Explore a code repository as an interactive map of its files, functions, classes, variables and libraries, and how they connect.

**Open the app:** https://timothyhoytbsme.github.io/RepoVisualizer/

- Load any public GitHub repository (`owner/repo` or a link), or open a `.zip` / folder from your device. Local files never leave your device.
- Select a node to see its code in context; hover or long-press to peek.
- The depth slider controls how many steps away from the selected node are shown.
- Arrows mean "uses / depends on"; plain lines mean "related" (a name match the analyzer couldn't pin down) or "contains".
- Works with mouse, touch, keyboard and gamepad. Runs entirely in the browser, with nothing to install.

Share a view with a link like `?repo=pallets/flask&node=f:src/flask/app.py&depth=2`.

## Controls

| Action | Mouse / touch | Keyboard | Gamepad |
| --- | --- | --- | --- |
| Pan | drag | WASD / Shift+arrows | left stick |
| Zoom | wheel / pinch | + / − | triggers |
| Move highlight | — | arrows | D-pad / right stick |
| Select | click / tap | Enter | A |
| Depth | slider | [ / ] | LB / RB |
| Recenter | click the selected node | C | B |
| Details panel | tap the sheet | P | X |
| Switch map | menu | M | Y |
| Search | search box | / | — |
