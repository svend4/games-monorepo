import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const smokeScript = path.join(scriptDirectory, "browser-smoke.mjs");
const profilePrefix = "small-steps-smoke-";

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
]);

export function resolveStaticPath(rootDirectory, requestPathname) {
  let pathname;
  try {
    pathname = decodeURIComponent(requestPathname);
  } catch {
    return null;
  }

  if (pathname.includes("\0")) return null;

  const relativePath = pathname.replace(/^\/+/, "");
  const requestedFile = pathname.endsWith("/")
    ? path.join(relativePath, "index.html")
    : relativePath || "index.html";
  const candidate = path.resolve(rootDirectory, requestedFile);
  const relativeToRoot = path.relative(path.resolve(rootDirectory), candidate);

  if (
    relativeToRoot === ".." ||
    relativeToRoot.startsWith(".." + path.sep) ||
    path.isAbsolute(relativeToRoot)
  ) {
    return null;
  }

  return candidate;
}

export function browserExecutableCandidates(
  environment = process.env,
  platform = process.platform,
) {
  const candidates = [environment.CHROME_BIN];
  const platformPath = platform === "win32" ? path.win32 : path;

  if (platform === "win32") {
    for (const baseDirectory of [
      environment.ProgramFiles,
      environment["ProgramFiles(x86)"],
      environment.LOCALAPPDATA,
    ]) {
      if (!baseDirectory) continue;
      candidates.push(
        platformPath.join(baseDirectory, "Google/Chrome/Application/chrome.exe"),
        platformPath.join(baseDirectory, "Chromium/Application/chrome.exe"),
        platformPath.join(baseDirectory, "Microsoft/Edge/Application/msedge.exe"),
      );
    }
  } else if (platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    );
  } else {
    const searchDirectories = (environment.PATH ?? "").split(path.delimiter).filter(Boolean);
    for (const executable of [
      "google-chrome",
      "google-chrome-stable",
      "chromium",
      "chromium-browser",
      "microsoft-edge",
    ]) {
      for (const directory of searchDirectories) {
        candidates.push(path.join(directory, executable));
      }
    }
  }

  return [...new Set(candidates.filter(Boolean))];
}

export function browserShutdownMode(platform = process.platform) {
  return platform === "win32" ? "process-tree" : "graceful";
}

async function findBrowserExecutable() {
  for (const candidate of browserExecutableCandidates()) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next known Chromium-based browser location.
    }
  }

  throw new Error(
    "Chrome, Chromium or Edge was not found. Set CHROME_BIN to its executable path.",
  );
}

async function startStaticServer(rootDirectory) {
  const server = createServer(async (request, response) => {
    const method = request.method ?? "GET";
    if (!["GET", "HEAD"].includes(method)) {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end();
      return;
    }

    let pathname;
    try {
      pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    } catch {
      response.writeHead(400);
      response.end("Bad request");
      return;
    }

    const filePath = resolveStaticPath(rootDirectory, pathname);
    if (!filePath) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) throw new Error("Not a file");
      const body = await readFile(filePath);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": body.byteLength,
        "Content-Type": contentTypes.get(path.extname(filePath).toLowerCase()) ??
          "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(method === "HEAD" ? undefined : body);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });

  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("The local smoke server did not expose a TCP port.");
  }

  return {
    origin: "http://127.0.0.1:" + address.port,
    close: () => new Promise((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

async function findAvailablePort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = address && typeof address !== "string" ? address.port : null;
  await new Promise((resolve) => server.close(resolve));
  if (!port) throw new Error("Could not reserve a local Chrome debugging port.");
  return port;
}

async function waitForChrome(cdpOrigin, timeoutMs = 12_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(cdpOrigin + "/json/list");
      if (response.ok) return;
    } catch {
      // Chrome may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Chrome DevTools did not become ready at " + cdpOrigin + ".");
}

async function requestBrowserClose(cdpOrigin) {
  try {
    const response = await fetch(cdpOrigin + "/json/version");
    if (!response.ok) return;
    const details = await response.json();
    if (!details.webSocketDebuggerUrl) return;

    await new Promise((resolve) => {
      const socket = new WebSocket(details.webSocketDebuggerUrl);
      const finish = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        socket.close();
        resolve();
      }, 2_000);
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ id: 1, method: "Browser.close" }));
      }, { once: true });
      socket.addEventListener("close", finish, { once: true });
      socket.addEventListener("error", finish, { once: true });
    });
  } catch {
    // Process termination below remains available as a fallback.
  }
}

async function waitForProcessExit(child, timeoutMs = 3_000) {
  if (child.exitCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function terminateWindowsProcessTree(processId) {
  if (!Number.isInteger(processId) || processId <= 0) return false;

  const terminator = spawn(
    "taskkill",
    ["/PID", String(processId), "/T", "/F"],
    { stdio: "ignore", windowsHide: true },
  );

  return new Promise((resolve) => {
    terminator.once("error", () => resolve(false));
    terminator.once("exit", (code) => resolve(code === 0));
  });
}

async function stopBrowser(browserProcess, cdpOrigin) {
  if (browserProcess.exitCode !== null) return;

  if (browserShutdownMode() === "process-tree") {
    const treeTerminated = await terminateWindowsProcessTree(browserProcess.pid);
    if (!treeTerminated && browserProcess.exitCode === null) {
      browserProcess.kill();
    }
    await waitForProcessExit(browserProcess);
    return;
  }

  await requestBrowserClose(cdpOrigin);
  await waitForProcessExit(browserProcess, 2_000);
  if (browserProcess.exitCode === null) {
    browserProcess.kill();
    await waitForProcessExit(browserProcess);
  }
}

async function removeProfileDirectory(profileDirectory) {
  const resolvedProfile = path.resolve(profileDirectory);
  const relativeToTemp = path.relative(path.resolve(tmpdir()), resolvedProfile);
  if (
    path.basename(resolvedProfile).startsWith(profilePrefix) &&
    relativeToTemp &&
    !relativeToTemp.startsWith(".." + path.sep) &&
    !path.isAbsolute(relativeToTemp)
  ) {
    await rm(resolvedProfile, {
      force: true,
      maxRetries: 10,
      recursive: true,
      retryDelay: 250,
    });
  }
}

async function startIsolatedBrowser() {
  const executable = await findBrowserExecutable();
  const port = await findAvailablePort();
  const profileDirectory = await mkdtemp(path.join(tmpdir(), profilePrefix));
  const cdpOrigin = "http://127.0.0.1:" + port;
  const browserProcess = spawn(executable, [
    "--headless=new",
    "--remote-debugging-port=" + port,
    "--user-data-dir=" + profileDirectory,
    "--disable-background-networking",
    "--disable-breakpad",
    "--disable-crash-reporter",
    "--no-default-browser-check",
    "--no-first-run",
    "about:blank",
  ], {
    stdio: "ignore",
    windowsHide: true,
  });

  try {
    await Promise.race([
      waitForChrome(cdpOrigin),
      new Promise((_, reject) => {
        browserProcess.once("error", reject);
        browserProcess.once("exit", (code, signal) => {
          reject(new Error(
            "The browser exited before its debugging endpoint was ready" +
              (signal ? " (" + signal + ")." : " (exit code " + code + ")."),
          ));
        });
      }),
    ]);
  } catch (error) {
    await stopBrowser(browserProcess, cdpOrigin);
    await removeProfileDirectory(profileDirectory);
    throw error;
  }

  return {
    cdpOrigin,
    close: async () => {
      await stopBrowser(browserProcess, cdpOrigin);
      await removeProfileDirectory(profileDirectory);
    },
  };
}

async function runChildSmoke(environment) {
  const child = spawn(process.execPath, [smokeScript], {
    cwd: repositoryRoot,
    env: environment,
    stdio: "inherit",
    windowsHide: true,
  });

  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error("Browser smoke was stopped by " + signal + "."));
      else resolve(code ?? 1);
    });
  });
}

export async function runBrowserSmoke() {
  let localServer;
  let isolatedBrowser;

  try {
    const appOrigin = process.env.APP_ORIGIN?.replace(/\/+$/, "") ??
      (localServer = await startStaticServer(repositoryRoot)).origin;
    const cdpOrigin = process.env.CDP_ORIGIN?.replace(/\/+$/, "") ??
      (isolatedBrowser = await startIsolatedBrowser()).cdpOrigin;

    return await runChildSmoke({
      ...process.env,
      APP_ORIGIN: appOrigin,
      CDP_ORIGIN: cdpOrigin,
    });
  } finally {
    await isolatedBrowser?.close();
    await localServer?.close();
  }
}

const isMain = process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;


if (isMain) {
  try {
    process.exitCode = await runBrowserSmoke();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
