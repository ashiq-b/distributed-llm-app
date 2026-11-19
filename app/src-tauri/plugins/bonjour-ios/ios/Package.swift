// swift-tools-version:5.3

import PackageDescription

let package = Package(
  name: "tauri-plugin-bonjour-ios",
  platforms: [
    .iOS(.v13)
  ],
  products: [
    .library(
      name: "tauri-plugin-bonjour-ios",
      type: .static,
      targets: ["tauri-plugin-bonjour-ios"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-bonjour-ios",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
