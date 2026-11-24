# Data provenance and attribution

Localized game dialogue and event data are Nintendo game content. This repository does not claim ownership of that content or grant a license to it. The comparison tool is an independent research utility and is not affiliated with Nintendo.

The included data was exported from the supplied Ocarina of Time Switch 2 package, package index 1, identified in the analysis workspace as revision 1.1.1. It is not the N64 message catalog. The original supplied NUP SHA-256 is:

```text
f6b16ea3a4e98652db93320e5c9e68a52b2faff25efb671727997e471f97c0a8
```

Archive member hashes are retained with localized message details. EventFlow source hashes are retained in `data/flows.json.gz`. The original package, executable code, audio, images, and user route files are not included.

The analysis pipeline consulted or used these pinned projects:

- [lunixxx37/NupExplorer](https://github.com/lunixxx37/NupExplorer), MIT, revision `6d6d356e4c108dfb754ce4747f378d0d8a582b56`: `nupx/msbt.py` was a format reference for the analysis workspace's separate strict MSBT parser. NupExplorer code is not distributed or required by the browser runtime.
- [zeldamods/evfl](https://github.com/zeldamods/evfl), GPL version 2 or later, revision `9e33dbadfc76516e7f87c5d8f4d98874b393e3e2`: used to decode the event resources in the analysis pipeline. The library is not distributed or required by the browser runtime. The published traversal reads the resulting structural JSON; it does not execute the game's native query functions.

UI previews are extracted text and authored page breaks, not a recreation of the game's text renderer. Event aliases are research labels; unaliased names remain the original resource identifiers.
