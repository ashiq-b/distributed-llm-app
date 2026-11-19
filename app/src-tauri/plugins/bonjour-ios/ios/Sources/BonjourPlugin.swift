// Bonjour for DistLLM on iOS, through the system's mDNSResponder.
//
// NetService (not NWListener) advertises: llama.cpp's RPC server already owns the
// worker port, and NetService can announce a port it doesn't listen on. The browser
// resolves each service (addresses + TXT) and monitors its TXT record, whose `seq`
// heartbeat tells the Rust side the peer is still there. Rust polls `snapshot`.
// All NetService work happens on the main thread (its run loop delivers the callbacks).
//
// iOS stops Bonjour work while the app is in the background, and a stopped
// NetService/NetServiceBrowser doesn't come back by itself. So on returning to the
// foreground (or when iOS reports a failure) both are recreated.

import Foundation
import Tauri
import UIKit

struct PublishArgs: Decodable {
  let name: String
  let port: Int32
  let txt: [String: String]
}

struct KeepAwakeArgs: Decodable {
  let enabled: Bool
}

private let serviceType = "_distllm._tcp."

class BonjourPlugin: Plugin, NetServiceBrowserDelegate, NetServiceDelegate {
  private var published: NetService?
  /// What we were asked to announce last; re-announced after the app was in the background.
  private var lastPublish: PublishArgs?
  private var browser: NetServiceBrowser?
  private var wantBrowsing = false
  private var observingForeground = false
  /// Found services by instance name, with what has been resolved so far.
  private var found: [String: NetService] = [:]
  private var txt: [String: [[String]]] = [:]
  private var addresses: [String: [String]] = [:]

  @objc public func publish(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PublishArgs.self)
    let record = NetService.data(fromTXTRecord: args.txt.mapValues { Data($0.utf8) })
    DispatchQueue.main.async {
      self.observeForeground()
      self.lastPublish = args
      if let s = self.published, s.name == args.name, s.port == Int(args.port) {
        // Same service: a new TXT record is re-announced to browsers.
        s.setTXTRecord(record)
      } else {
        self.startPublishing(args)
      }
      invoke.resolve()
    }
  }

  private func startPublishing(_ args: PublishArgs) {
    published?.stop()
    let s = NetService(domain: "local.", type: serviceType, name: args.name, port: args.port)
    s.delegate = self
    s.setTXTRecord(NetService.data(fromTXTRecord: args.txt.mapValues { Data($0.utf8) }))
    s.publish()
    published = s
  }

  private func startBrowser() {
    browser?.stop()
    for service in found.values { service.stop(); service.stopMonitoring() }
    found.removeAll()
    txt.removeAll()
    addresses.removeAll()
    let b = NetServiceBrowser()
    b.delegate = self
    b.searchForServices(ofType: serviceType, inDomain: "local.")
    browser = b
  }

  private func observeForeground() {
    if observingForeground { return }
    observingForeground = true
    NotificationCenter.default.addObserver(
      forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main
    ) { [weak self] _ in
      guard let self = self else { return }
      if let args = self.lastPublish { self.startPublishing(args) }
      if self.wantBrowsing { self.startBrowser() }
    }
  }

  @objc public func unpublish(_ invoke: Invoke) throws {
    DispatchQueue.main.async {
      self.published?.stop()  // sends a goodbye
      self.published = nil
      self.lastPublish = nil
      invoke.resolve()
    }
  }

  @objc public func startBrowsing(_ invoke: Invoke) throws {
    DispatchQueue.main.async {
      self.observeForeground()
      self.wantBrowsing = true
      if self.browser == nil { self.startBrowser() }
      invoke.resolve()
    }
  }

  /// Services currently listed by the browser, with their latest TXT and addresses.
  @objc public func snapshot(_ invoke: Invoke) throws {
    DispatchQueue.main.async {
      // A search iOS stopped (didNotSearch) is restarted here, on the next poll.
      if self.wantBrowsing && self.browser == nil { self.startBrowser() }
      let services: [[String: Any]] = self.found.keys.sorted().map { name in
        ["name": name, "txt": self.txt[name] ?? [], "addresses": self.addresses[name] ?? []]
      }
      invoke.resolve(["services": services])
    }
  }

  @objc public func setKeepAwake(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(KeepAwakeArgs.self)
    DispatchQueue.main.async {
      UIApplication.shared.isIdleTimerDisabled = args.enabled
      invoke.resolve()
    }
  }

  // MARK: NetServiceBrowserDelegate

  func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
    found[service.name]?.stop()
    found[service.name] = service
    service.delegate = self
    service.resolve(withTimeout: 5)
    service.startMonitoring()
  }

  func netServiceBrowser(_ browser: NetServiceBrowser, didRemove service: NetService, moreComing: Bool) {
    found.removeValue(forKey: service.name)?.stopMonitoring()
    txt.removeValue(forKey: service.name)
    addresses.removeValue(forKey: service.name)
  }

  func netServiceBrowser(_ browser: NetServiceBrowser, didNotSearch errorDict: [String: NSNumber]) {
    if browser === self.browser { self.browser = nil }
  }

  // MARK: NetServiceDelegate

  func netService(_ sender: NetService, didNotPublish errorDict: [String: NSNumber]) {
    // Dropped so the next heartbeat publishes a fresh service.
    if sender === published { published = nil }
  }

  func netServiceDidResolveAddress(_ sender: NetService) {
    addresses[sender.name] = (sender.addresses ?? []).compactMap(numericHost)
    if let data = sender.txtRecordData() {
      txt[sender.name] = decodeTXT(data)
    }
  }

  func netService(_ sender: NetService, didUpdateTXTRecord data: Data) {
    txt[sender.name] = decodeTXT(data)
  }
}

/// TXT record → [[key, value]] (values as UTF-8).
private func decodeTXT(_ data: Data) -> [[String]] {
  NetService.dictionary(fromTXTRecord: data).map { key, value in
    [key, String(decoding: value, as: UTF8.self)]
  }
}

/// sockaddr bytes → "192.168.1.2" (or IPv6 text).
private func numericHost(_ data: Data) -> String? {
  data.withUnsafeBytes { raw -> String? in
    guard let sa = raw.baseAddress?.assumingMemoryBound(to: sockaddr.self) else { return nil }
    var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
    guard getnameinfo(sa, socklen_t(data.count), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 else {
      return nil
    }
    return String(cString: host)
  }
}

@_cdecl("init_plugin_bonjour")
func initPlugin() -> Plugin {
  return BonjourPlugin()
}
