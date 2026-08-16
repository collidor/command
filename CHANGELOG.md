## [7.0.5](https://github.com/collidor/command/compare/v7.0.4...v7.0.5) (2026-08-16)


### Bug Fixes

* trigger patch release ([dc21668](https://github.com/collidor/command/commit/dc21668de2189ebdd7b48eb4e3775061ec741ba4))

## [7.0.4](https://github.com/collidor/command/compare/v7.0.3...v7.0.4) (2026-08-15)


### Bug Fixes

* **ci:** add dummy NPM_TOKEN to satisfy semantic-release preflight check for OIDC ([ed30460](https://github.com/collidor/command/commit/ed3046019e19cde88c57bf7a1a620c877491969f))
* **ci:** decouple npm and jsr publish from semantic-release ([eba8cc7](https://github.com/collidor/command/commit/eba8cc7fe6505295c9389916db6262b606a3b34b))
* **ci:** re-enable native semantic-release npm publishing for OIDC ([a22fe1f](https://github.com/collidor/command/commit/a22fe1f7f015e779ed26614a01154215c77eb8b8))

## [7.0.3](https://github.com/collidor/command/compare/v7.0.2...v7.0.3) (2026-08-15)


### Bug Fixes

* **ci:** remove registry-url to prevent setup-node from creating broken .npmrc that blocks OIDC ([6b6b4c8](https://github.com/collidor/command/commit/6b6b4c8686c48a350d92eba68b3b32b6d086a8e3))

## [7.0.2](https://github.com/collidor/command/compare/v7.0.1...v7.0.2) (2026-08-15)


### Bug Fixes

* **ci:** add --allow-dirty to jsr publish to ignore uncommitted lockfiles ([d8f58c0](https://github.com/collidor/command/commit/d8f58c07e4fc9d67cbe42b9226f5a611278f07b0))

## [1.0.3](https://github.com/collidor/command/compare/v1.0.2...v1.0.3) (2026-08-15)


### Bug Fixes

* publish oidc ([7d0c61d](https://github.com/collidor/command/commit/7d0c61de09624ea7a69eeb9cfe6e218470b1bf06))

## [1.0.2](https://github.com/collidor/command/compare/v1.0.1...v1.0.2) (2026-08-15)


### Bug Fixes

* another publish try ([d57c73e](https://github.com/collidor/command/commit/d57c73ece40f7bbd2aac2610a99ca626b7cc1236))

## [1.0.1](https://github.com/collidor/command/compare/v1.0.0...v1.0.1) (2026-08-15)


### Bug Fixes

* **ci:** rename workflow file to publish.yml to match npm trusted publisher configuration ([3252223](https://github.com/collidor/command/commit/325222377046f37ae4034327ddf4d3db3675597c))

# 1.0.0 (2026-08-15)


### Bug Fixes

* add tests ([e9c9011](https://github.com/collidor/command/commit/e9c9011288fde939dfac992908f5ec57a1be6d41))
* **build:** add @swc/core devDependency required for tsup es5 build target ([8130e86](https://github.com/collidor/command/commit/8130e860bfc41c9d0c0818d2df3c292d7d6e3685))
* **ci:** configure npmPublish false and provenance publishCmd for tokenless npm OIDC, fix repo URL format ([29d8686](https://github.com/collidor/command/commit/29d86864a843c5954835b18d2ca13b30b2ecc566))
* **ci:** update release pipeline to use OIDC trusted publishing without tokens ([42c8bd1](https://github.com/collidor/command/commit/42c8bd17d39a743bd7a5e342f282a3cfc9df633c))
* command unsubscription ([eae5bcc](https://github.com/collidor/command/commit/eae5bcce5de892920f96b9dd570558d0f536a2f1))
* improve ack to portChannelPlugin command handling ([2e44d24](https://github.com/collidor/command/commit/2e44d24299092c2b3a520bfaa1fa1db4ccae5949))
* port unsubscription ([1192c2c](https://github.com/collidor/command/commit/1192c2c8ac7d9eb2706e19e074f9d1620ac49013))
* returning all stream handler messages to the first subscriber ([9de2313](https://github.com/collidor/command/commit/9de2313e2004a56d3f144aaeee77183c3e495ce2))


### Features

* add automated semantic-release pipeline for npm and jsr ([1b951e2](https://github.com/collidor/command/commit/1b951e2fffa81b2338b2b22ffef866543e4e543f))
* make return optional and accept abort signals ([11ddd15](https://github.com/collidor/command/commit/11ddd159b853fdf3caf4c797eb5244ff198f6d27))
* update @collidor/event ([43a7942](https://github.com/collidor/command/commit/43a7942603c0703786f48574f34e90c0b7061821))

# @collidor/command

## 7.0.1

### Patch Changes

- fix imports
- Updated dependencies
  - @collidor/event@4.3.3

## 7.0.0

### Major Changes

- Y

## 6.0.3

### Patch Changes

- Add observable event
- Updated dependencies
  - @collidor/event@4.3.2

## 6.0.2

### Patch Changes

- Added observable command

## 6.0.1

### Patch Changes

- Create result and fix dependencies sync
- Updated dependencies
  - @collidor/event@4.3.1

## 6.0.0

### Patch Changes

- Add cleanup callback to event.on return
- Updated dependencies
  - @collidor/event@4.3.0

## 5.3.15

### Patch Changes

- update tsup and export injector register type
- Updated dependencies
  - @collidor/event@4.2.13

## 5.3.14

### Patch Changes

- Reupload
- Updated dependencies
  - @collidor/event@4.2.12

## 5.3.13

### Patch Changes

- add schema toolkit
- Updated dependencies
  - @collidor/event@4.2.11

## 5.3.12

### Patch Changes

- a8b57a3: change export name
- 80e351b: add command to toolkit

## 5.3.11

### Patch Changes

- publish
- Updated dependencies
  - @collidor/event@4.2.10

## 5.3.10

### Patch Changes

- publish test
- Updated dependencies
  - @collidor/event@4.2.9

## 5.3.9

### Patch Changes

- test publish
- Updated dependencies
  - @collidor/event@4.2.8

## 5.3.8

### Patch Changes

- 09d97fb: publish test
- publish test
- Updated dependencies [09d97fb]
- Updated dependencies
  - @collidor/event@4.2.7

## 5.3.7

### Patch Changes

- 17c8fc2: publish test
- publish
- Updated dependencies [17c8fc2]
- Updated dependencies
- Updated dependencies [17c8fc2]
  - @collidor/event@4.2.6

## 5.3.6

### Patch Changes

- publish
- Updated dependencies
  - @collidor/event@4.2.5

## 5.3.5

### Patch Changes

- 750cba9: publish
- Updated dependencies [750cba9]
  - @collidor/event@4.2.4

## 5.3.4

### Patch Changes

- publish
- Updated dependencies
  - @collidor/event@4.2.3

## 5.3.3

### Patch Changes

- publish
- 9f45da4: publish
- Updated dependencies
- Updated dependencies [9f45da4]
  - @collidor/event@4.2.2
