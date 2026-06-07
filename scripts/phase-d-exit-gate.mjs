#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const DEFAULT_CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEFAULT_URL = "http://127.0.0.1:4173/";
const todayStamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
const DEFAULT_OUT_DIR = `history/artifacts/phase-d-exit-gate-${todayStamp}`;

const chromeBin = process.env.CHROME_BIN ?? DEFAULT_CHROME;
const targetUrl = process.env.PHASE_D_URL ?? DEFAULT_URL;
const outDir = process.argv[2] ?? DEFAULT_OUT_DIR;
const port = Number(process.env.CDP_PORT ?? 9223);
const userDataDir = path.join("/tmp", `coachroyale-phase-d-${process.pid}`);
const axeSourcePath = new URL(
  "../apps/web/node_modules/axe-core/axe.min.js",
  import.meta.url,
);

const viewports = [
  { name: "empty-390", width: 390, height: 1200, mobile: true },
  { name: "empty-768", width: 768, height: 1400, mobile: false },
  { name: "empty-1280", width: 1280, height: 1400, mobile: false },
];

class CdpSession {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;

      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);

      if (message.error) {
        waiter.reject(
          new Error(`${message.error.message}: ${message.error.data ?? ""}`),
        );
        return;
      }
      waiter.resolve(message.result);
    });
  }

  static async connect(webSocketDebuggerUrl) {
    const socket = new WebSocket(webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return new CdpSession(socket);
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;

    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return promise;
  }

  close() {
    this.socket.close();
  }
}

async function waitForDevTools() {
  const endpoint = `http://127.0.0.1:${port}/json/version`;
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(endpoint);
      if (response.ok) return;
    } catch {
      // Chrome is still starting.
    }
    await delay(250);
  }

  throw new Error(`Chrome DevTools did not become available at ${endpoint}`);
}

async function getPageTarget() {
  const listUrl = `http://127.0.0.1:${port}/json/list`;
  const targets = await fetch(listUrl).then((response) => response.json());
  const pageTarget = targets.find((target) => target.type === "page");
  if (!pageTarget?.webSocketDebuggerUrl) {
    throw new Error(
      "No Chrome page target was available for DevTools automation.",
    );
  }
  return pageTarget.webSocketDebuggerUrl;
}

async function evaluateJson(session, expression) {
  const result = await session.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      `Runtime evaluation failed: ${result.exceptionDetails.text}`,
    );
  }
  return result.result.value;
}

async function waitForRenderedApp(session) {
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    const rendered = await evaluateJson(
      session,
      `(() => {
        const root = document.querySelector('#root');
        return document.readyState === 'complete'
          && Boolean(root)
          && root.innerText.includes('Declaw')
          && document.body.scrollHeight > 400;
      })()`,
    );
    if (rendered) return;
    await delay(250);
  }

  throw new Error(
    "The app did not render the expected Declaw shell before timeout.",
  );
}

async function inspectPage(session) {
  return evaluateJson(
    session,
    `(() => {
      const visibleText = document.body.innerText;
      const namedButtons = Array.from(document.querySelectorAll('button')).map((button) => ({
        text: button.innerText.trim(),
        ariaLabel: button.getAttribute('aria-label'),
        title: button.getAttribute('title'),
      }));
      const emptyNamedButtons = namedButtons.filter((button) =>
        !button.text && !button.ariaLabel && !button.title
      );
      const unlabeledInputs = Array.from(document.querySelectorAll('input, textarea')).filter((input) => {
        const id = input.getAttribute('id');
        const hasLabel = id && document.querySelector('label[for="' + CSS.escape(id) + '"]');
        return !hasLabel && !input.getAttribute('aria-label') && !input.getAttribute('aria-labelledby');
      });
      return {
        title: document.title,
        h1Count: document.querySelectorAll('h1').length,
        bodyTextSample: visibleText.slice(0, 500),
        imageCount: document.querySelectorAll('img').length,
        imagesMissingAlt: document.querySelectorAll('img:not([alt])').length,
        buttonCount: namedButtons.length,
        emptyNamedButtonCount: emptyNamedButtons.length,
        inputCount: document.querySelectorAll('input, textarea').length,
        unlabeledInputCount: unlabeledInputs.length,
        hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    })()`,
  );
}

async function runAxe(session, axeSource) {
  await session.send("Runtime.evaluate", {
    expression: axeSource,
    awaitPromise: false,
    returnByValue: false,
  });

  return evaluateJson(
    session,
    `axe.run(document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']
      }
    }).then((result) => ({
      passes: result.passes.length,
      violations: result.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        helpUrl: violation.helpUrl,
        nodes: violation.nodes.map((node) => ({
          target: node.target,
          failureSummary: node.failureSummary
        }))
      })),
      incomplete: result.incomplete.map((check) => ({
        id: check.id,
        impact: check.impact,
        help: check.help,
        helpUrl: check.helpUrl,
        nodes: check.nodes.map((node) => ({
          target: node.target,
          failureSummary: node.failureSummary
        }))
      }))
    }))`,
  );
}

async function captureViewport(session, viewport, axeSource) {
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.mobile,
  });
  await session.send("Page.navigate", { url: targetUrl });
  await waitForRenderedApp(session);
  await delay(750);

  const screenshot = await session.send("Page.captureScreenshot", {
    captureBeyondViewport: true,
    format: "png",
    fromSurface: true,
  });
  const filePath = path.join(outDir, `${viewport.name}.png`);
  await writeFile(filePath, Buffer.from(screenshot.data, "base64"));

  return {
    viewport,
    screenshot: filePath,
    inspection: await inspectPage(session),
    axe: await runAxe(session, axeSource),
  };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const axeSource = await readFile(axeSourcePath, "utf8");

  const chrome = spawn(
    chromeBin,
    [
      "--headless=new",
      "--disable-gpu",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-crash-reporter",
      "--disable-breakpad",
      "--disable-sync",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ],
    {
      stdio: ["ignore", "ignore", "pipe"],
    },
  );

  const stderr = [];
  chrome.stderr.on("data", (chunk) => {
    stderr.push(chunk.toString());
  });
  const chromeExited = new Promise((resolve) => {
    chrome.once("exit", resolve);
  });

  let session;
  try {
    await waitForDevTools();
    session = await CdpSession.connect(await getPageTarget());
    await session.send("Page.enable");
    await session.send("Runtime.enable");

    const results = [];
    for (const viewport of viewports) {
      results.push(await captureViewport(session, viewport, axeSource));
    }

    const failedChecks = results.flatMap((result) => {
      const { inspection, viewport } = result;
      const prefix = `${viewport.width}px`;
      return [
        inspection.h1Count < 1 ? `${prefix}: missing h1` : null,
        inspection.imagesMissingAlt > 0 ? `${prefix}: image without alt` : null,
        inspection.emptyNamedButtonCount > 0
          ? `${prefix}: button without accessible name`
          : null,
        inspection.unlabeledInputCount > 0
          ? `${prefix}: input without label`
          : null,
        inspection.hasHorizontalOverflow
          ? `${prefix}: horizontal overflow`
          : null,
        result.axe.violations.length > 0
          ? `${prefix}: axe violations (${result.axe.violations.map((violation) => violation.id).join(", ")})`
          : null,
      ].filter(Boolean);
    });

    const report = {
      url: targetUrl,
      generated_at: new Date().toISOString(),
      checks: {
        basic_accessibility: failedChecks.length === 0 ? "pass" : "fail",
        axe: failedChecks.some((check) => check.includes("axe violations"))
          ? "fail"
          : "pass",
        failed_checks: failedChecks,
      },
      results,
    };

    await writeFile(
      path.join(outDir, "phase-d-browser-check.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );

    if (failedChecks.length > 0) {
      console.error(
        `Phase D browser checks failed:\n- ${failedChecks.join("\n- ")}`,
      );
      process.exitCode = 1;
    } else {
      console.log(
        `Phase D browser checks passed. Artifacts written to ${outDir}`,
      );
    }
  } finally {
    session?.close();
    chrome.kill("SIGTERM");
    await Promise.race([
      chromeExited,
      delay(3_000).then(() => chrome.kill("SIGKILL")),
    ]);
    await rm(userDataDir, {
      force: true,
      maxRetries: 5,
      recursive: true,
      retryDelay: 200,
    }).catch(() => undefined);
    if (process.exitCode && stderr.length > 0) {
      console.error(stderr.join("").slice(0, 4000));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
