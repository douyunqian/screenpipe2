import { $ } from 'bun'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

const isDevMode = process.env.SCREENPIPE_APP_DEV === 'true' || false;

const originalCWD = process.cwd()
// Change CWD to src-tauri
process.chdir(path.join(__dirname, '../src-tauri'))
const platform = {
	win32: 'windows',
	darwin: 'macos',
	linux: 'linux',
}[os.platform()]
const cwd = process.cwd()
console.log('cwd', cwd)

// 修复：补全 config 结构，统一 ffmpegRealname 定义
const config = {
	ffmpegRealname: platform === 'windows' ? "./ffmpeg.exe" : 'ffmpeg',
	windows: {
		// 适配实际下载的 8.0.1 版本压缩包
		ffmpegUrl: "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-full-shared.7z",
		ffmpegName: "ffmpeg",
		ffmpegRealname: "./ffmpeg.exe"
	},
	linux: {
		aptPackages: [
			'tesseract-ocr',
			'libtesseract-dev',
			'ffmpeg',
			'pkg-config',
			'build-essential',
			'libglib2.0-dev',
			'libgtk-3-dev',
			'libwebkit2gtk-4.1-dev',
			'clang',
			'cmake', // Tauri
			'libavutil-dev',
			'libavformat-dev',
			'libavfilter-dev',
			'libavdevice-dev', // FFMPEG
			'libasound2-dev', // cpal
			'libxdo-dev'
		],
		tesseractUrl: 'https://github.com/DanielMYT/tesseract-static/releases/download/tesseract-5.5.0/tesseract',
		tesseractName: 'tesseract',
		ffmpegName: 'ffmpeg-7.0.2-amd64-static',
		ffmpegUrl: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
	},
	macos: {
		ffmpegUrlArm: 'https://www.osxexperts.net/ffmpeg7arm.zip',
		ffprobeUrlArm: 'https://www.osxexperts.net/ffprobe71arm.zip',
		ffmpegUrlx86_64: 'https://evermeet.cx/ffmpeg/getrelease/zip',
		ffprobeUrlx86_64: 'https://www.osxexperts.net/ffprobe71intel.zip',
	},
}

// 新增：递归遍历目录查找指定文件（兜底逻辑）
async function findFileRecursive(dir, filename) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      // 找到目标文件
      if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) {
        return fullPath;
      }
      // 递归查找子目录（跳过符号链接，避免循环）
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        const found = await findFileRecursive(fullPath, filename);
        if (found) return found;
      }
    }
  } catch (e) {
    console.warn(`遍历目录 ${dir} 时出错：${e.message}`);
  }
  return null;
}

// 新增：跨平台打印目录结构（替换不兼容的 dir 命令）
async function printDirectoryStructure(dir) {
  try {
    if (platform === 'windows') {
      // Windows 原生 dir 命令（适配 PowerShell/CMD）
      await $`cmd /c dir "${dir}" /s /b`;
    } else {
      // Linux/macOS 使用 ls
      await $`ls -R "${dir}"`;
    }
  } catch (e) {
    console.warn(`打印目录结构失败（非关键错误）：${e.message}`);
  }
}

// 修复：封装 FFmpeg 下载逻辑（含备用链接）
async function downloadFFmpeg(wgetPath) {
  try {
    console.log(`开始下载 FFmpeg: ${config.windows.ffmpegUrl}`);
    await $`${wgetPath} --no-config --tries=10 --retry-connrefused --waitretry=10 --secure-protocol=auto --no-check-certificate --show-progress ${config.windows.ffmpegUrl} -O ${config.windows.ffmpegName}.7z`;
  } catch (e) {
    console.error("FFmpeg 主链接下载失败，尝试备用链接...");
    // 备用链接（BtbN 镜像，结构更稳定）
    const fallbackUrl = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl-shared.7z";
    await $`${wgetPath} --no-config --tries=5 --show-progress ${fallbackUrl} -O ${config.windows.ffmpegName}.7z`;
  }
}

async function findWget() {
	const possiblePaths = [
		'C:\\ProgramData\\chocolatey\\bin\\wget.exe',
		'C:\\Program Files\\Git\\mingw64\\bin\\wget.exe',
		'C:\\msys64\\usr\\bin\\wget.exe',
		'C:\\Windows\\System32\\wget.exe',
		'C:\\wget\\wget.exe',
		'wget' // This will work if wget is in PATH
	];

	for (const wgetPath of possiblePaths) {
		try {
			await $`${wgetPath} --version`.quiet();
			console.log(`wget found at: ${wgetPath}`);
			return wgetPath;
		} catch (error) {
			// wget not found at this path, continue searching
		}
	}

	console.error('wget not found. Please install wget and make sure it\'s in your PATH.');
	process.exit(1);
}

// Export for Github actions
const exports = {
	ffmpeg: path.join(cwd, config.ffmpegRealname),
	libClang: 'C:\\Program Files\\LLVM\\bin',
	cmake: 'C:\\Program Files\\CMake\\bin',
	openBlas: '', // 补全缺失的变量定义
	clblast: ''   // 补全缺失的变量定义
}

// Add this function to copy the Bun binary
async function copyBunBinary() {
	console.log('checking bun binary for tauri...');

	let bunSrc, bunDest1, bunDest2;
	if (platform === 'windows') {
		// Get and log npm global prefix
		let npmGlobalPrefix = null;
		try {
			npmGlobalPrefix = (await $`npm config get prefix`.text()).trim();
			console.log('npm global prefix:', npmGlobalPrefix);
		} catch (error) {
			console.log('failed to get npm global prefix:', error.message);
		}

		// Try to find bun location using system commands
		let bunPathFromSystem;
		try {
			bunPathFromSystem = (await $`where.exe bun`.text()).trim().split('\n')[0];
		} catch {
			try {
				bunPathFromSystem = (await $`which bun`.text()).trim();
			} catch {
				console.log('could not find bun using where.exe or which');
			}
		}

		if (bunPathFromSystem) {
			console.log('found bun using system command at:', bunPathFromSystem);
		}

		// Start with basic paths that don't depend on npmGlobalPrefix
		const possibleBunPaths = [
			// Add system-found path if it exists
			bunPathFromSystem,
			// Bun's default installer location
			path.join(os.homedir(), '.bun', 'bin', 'bun.exe'),
			// AppData paths
			path.join(os.homedir(), 'AppData', 'Local', 'bun', 'bun.exe'),
			// Direct paths
			'C:\\Program Files\\bun\\bun.exe',
			'C:\\Program Files (x86)\\bun\\bun.exe',
			// System path
			'bun.exe'
		].filter(Boolean);

		// Add npm paths only if npmGlobalPrefix was successfully retrieved
		if (npmGlobalPrefix) {
			possibleBunPaths.push(
				path.join(npmGlobalPrefix, 'node_modules', 'bun', 'bin', 'bun.exe'),
				path.join(npmGlobalPrefix, 'bun.exe'),
				path.join(npmGlobalPrefix, 'bin', 'bun.exe')
			);
		}

		console.log('searching bun in these locations:');
		possibleBunPaths.forEach(p => console.log('- ' + p));

		bunSrc = null;
		for (const possiblePath of possibleBunPaths) {
			try {
				await fs.access(possiblePath);
				console.log('found bun at:', possiblePath);
				bunSrc = possiblePath;
				break;
			} catch {
				continue;
			}
		}

		if (!bunSrc) {
			throw new Error('Could not find bun.exe in any expected location. Please check if bun is installed correctly');
		}

		// Define the destination path
		bunDest1 = path.join(cwd, 'bun-x86_64-pc-windows-msvc.exe');
		console.log('copying bun from:', bunSrc);
		console.log('copying bun to:', bunDest1);
	} else if (platform === 'macos') {
		bunSrc = path.join(os.homedir(), '.bun', 'bin', 'bun');
		bunDest1 = path.join(cwd, 'bun-aarch64-apple-darwin');
		bunDest2 = path.join(cwd, 'bun-x86_64-apple-darwin');
	} else if (platform === 'linux') {
		bunSrc = path.join(os.homedir(), '.bun', 'bin', 'bun');
		bunDest1 = path.join(cwd, 'bun-x86_64-unknown-linux-gnu');
	}

	if (await fs.exists(bunDest1)) {
		console.log('bun binary already exists for tauri.');
		return;
	}

	try {
		await fs.access(bunSrc);
		await copyFile(bunSrc, bunDest1);
		console.log(`bun binary copied successfully from ${bunSrc} to ${bunDest1}`);

		if (platform === 'macos') {
			await copyFile(bunSrc, bunDest2);
			console.log(`bun binary also copied to ${bunDest2}`);
		}
	} catch (error) {
		console.error('failed to copy bun binary:', error);
		console.error('source path:', bunSrc);
		process.exit(1);
	}
}

// Helper function to copy file and set permissions
async function copyFile(src, dest) {
	await fs.copyFile(src, dest);
	await fs.chmod(dest, 0o755); // ensure the binary is executable
}

/* ########## Linux ########## */
if (platform == 'linux') {
	// Check and install APT packages
	try {
		const aptPackagesNotInstalled = [];

		// Check each package installation status
		for (const pkg of config.linux.aptPackages) {
			try {
				await $`dpkg -s ${pkg}`.quiet();
			} catch {
				aptPackagesNotInstalled.push(pkg);
			}
		}

		if (aptPackagesNotInstalled.length > 0) {
			console.log('the following required packages are missing:');
			aptPackagesNotInstalled.forEach(pkg => console.log(`  - ${pkg}`));
			console.log('\ninstalling missing packages...');

			console.log('updating package lists...');
			await $`sudo apt-get -qq update`;
			
			console.log('installing packages...');
			await $`sudo DEBIAN_FRONTEND=noninteractive apt-get -qq install -y ${aptPackagesNotInstalled}`;
			console.log('Package installation completed successfully ✅\n');
		} else {
			console.log('all required packages are already installed ✅\n');
		}
	} catch (error) {
		console.error("error checking/installing apt packages: %s", error.message);
	}

	// Copy screenpipe binary
	console.log('copying screenpipe binary for linux...');
	const potentialPaths = [
		path.join(__dirname, '..', '..', '..', '..', 'target', 'release', 'screenpipe'),
		path.join(__dirname, '..', '..', '..', '..', 'target', 'x86_64-unknown-linux-gnu', 'release', 'screenpipe'),
		path.join(__dirname, '..', '..', 'target', 'x86_64-unknown-linux-gnu', 'release', 'screenpipe'),
		path.join(__dirname, '..', '..', '..', 'target', 'release', 'screenpipe'),
		path.join(__dirname, '..', '..', 'target', 'release', 'screenpipe'),
		path.join(__dirname, '..', 'target', 'release', 'screenpipe'),
		'/home/runner/work/screenpipe/screenpipe/target/release/screenpipe',
	];

	let copied = false;
	for (const screenpipeSrc of potentialPaths) {
		if (process.env['SKIP_SCREENPIPE_SETUP']) {
			copied = true;
			break;
		}
		const screenpipeDest = path.join(cwd, 'screenpipe-x86_64-unknown-linux-gnu');
		try {
			await fs.copyFile(screenpipeSrc, screenpipeDest);
			console.log(`screenpipe binary copied successfully from ${screenpipeSrc}`);
			copied = true;
			break;
		} catch (error) {
			console.warn(`failed to copy screenpipe binary from ${screenpipeSrc}:`, error);
		}
	}

	if (!copied) {
		console.error("failed to copy screenpipe binary from any potential path.");
		// uncomment the following line if you want the script to exit on failure
		// process.exit(1);
	}

	// Setup FFMPEG (Linux 原生逻辑)
	if (!(await fs.exists(config.ffmpegRealname))) {
		await $`wget --no-config -nc ${config.linux.ffmpegUrl} -O ${config.linux.ffmpegName}.tar.xz`
		await $`tar xf ${config.linux.ffmpegName}.tar.xz`
		await $`mv ${config.linux.ffmpegName} ${config.ffmpegRealname}`
		await $`rm ${config.linux.ffmpegName}.tar.xz`
	} else {
		console.log('FFMPEG already exists');
	}

	// Setup TESSERACT
	if (!(await fs.exists(config.linux.tesseractName))) {
		await $`wget --no-config -nc ${config.linux.tesseractUrl} -O ${config.linux.tesseractName}`
		await $`chmod +x ${config.linux.tesseractName}` // Make the Tesseract binary executable
	} else {
		console.log('TESSERACT already exists');
	}
}

/* ########## Windows ########## */
if (platform == 'windows') {
	const wgetPath = await findWget();

	console.log('Copying screenpipe binary...');

	// 修复：扩展更多合理的 screenpipe.exe 查找路径
	const potentialPaths = [
		// 优先查找 GitHub Actions 标准路径
		path.join(process.env.GITHUB_WORKSPACE || '', 'target', 'release', 'screenpipe.exe'),
		path.join(process.env.GITHUB_WORKSPACE || '', 'target', 'x86_64-pc-windows-msvc', 'release', 'screenpipe.exe'),
		// 相对路径（兼容本地/CI）
		path.join(__dirname, '..', '..', 'target', 'release', 'screenpipe.exe'),
		path.join(__dirname, '..', '..', 'target', 'x86_64-pc-windows-msvc', 'release', 'screenpipe.exe'),
		path.join(__dirname, '..', 'target', 'release', 'screenpipe.exe'),
		// 旧路径兼容
		'D:\\a\\screenpipe\\screenpipe\\target\\release\\screenpipe.exe',
		'D:\\a\\screenpipe2\\screenpipe2\\target\\release\\screenpipe.exe',
		'D:\\a\\screenpipe2\\screenpipe2\\target\\x86_64-pc-windows-msvc\\release\\screenpipe.exe',
	];

	let copied = false;
	for (const screenpipeSrc of potentialPaths) {
		if (process.env['SKIP_SCREENPIPE_SETUP']) {
			copied = true;
			break;
		}
		const screenpipeDest = path.join(cwd, 'screenpipe-x86_64-pc-windows-msvc.exe');
		try {
			// 先检查文件是否存在
			await fs.access(screenpipeSrc);
			await fs.copyFile(screenpipeSrc, screenpipeDest);
			console.log(`Screenpipe binary copied successfully from ${screenpipeSrc}`);
			copied = true;
			break;
		} catch (error) {
			console.warn(`Failed to copy screenpipe binary from ${screenpipeSrc}:`, error.message);
		}
	}

	if (!copied) {
		console.error("Failed to copy screenpipe binary from any potential path.");
		console.error("Checked paths:", potentialPaths);
		process.exit(1);
	}

	// Setup FFMPEG（最终版修复：适配 8.0.1 目录结构 + 跨平台命令）
	if (!(await fs.exists(config.windows.ffmpegRealname))) {
	  await downloadFFmpeg(wgetPath);
	  try {
	    // 第一步：解压 7z 包到 ./ffmpeg 目录（7z 正确语法）
	    console.log(`开始解压 FFmpeg：7z x ${config.windows.ffmpegName}.7z -o./ffmpeg -y`);
	    const extractResult = await $`7z x ${config.windows.ffmpegName}.7z -o./ffmpeg -y`;
	    console.log(`解压结果：${extractResult.stdout}`);
	    
	    // 第二步：跨平台打印解压目录结构（修复 dir 命令不兼容问题）
	    console.log('=== 解压目录结构 ===');
	    await printDirectoryStructure("./ffmpeg");

	    // 第三步：精准适配 8.0.1 版本的目录结构 + 扩展所有常见结构
	    const possibleFfmpegPaths = [
	      // 适配你实际的 8.0.1 版本结构
	      "./ffmpeg/ffmpeg-8.0.1-full_build-shared/bin/ffmpeg.exe",
	      // 兼容其他版本的 Gyan.dev 结构
	      "./ffmpeg/ffmpeg-release-full-shared/bin/ffmpeg.exe",
	      // BtbN 镜像结构
	      "./ffmpeg/ffmpeg-master-latest-win64-gpl-shared/bin/ffmpeg.exe",
	      // 通用结构
	      "./ffmpeg/bin/ffmpeg.exe",
	      "./ffmpeg/ffmpeg.exe",
	      "./ffmpeg/win64/bin/ffmpeg.exe",
	      "./ffmpeg/x86_64/bin/ffmpeg.exe",
	    ];

	    // 第四步：先尝试预设路径
	    let ffmpegBinPath = null;
	    for (const p of possibleFfmpegPaths) {
	      if (await fs.exists(p)) {
	        ffmpegBinPath = p;
	        console.log(`✅ 预设路径找到 FFmpeg：${p}`);
	        break;
	      }
	    }

	    // 第五步：预设路径找不到，递归遍历解压目录（兜底逻辑）
	    if (!ffmpegBinPath) {
	      console.log('⚠️ 预设路径未找到，开始递归遍历解压目录...');
	      ffmpegBinPath = await findFileRecursive("./ffmpeg", "ffmpeg.exe");
	    }

	    // 第六步：最终检查
	    if (!ffmpegBinPath) {
	      throw new Error(`
❌ 未找到 ffmpeg.exe！
已尝试的预设路径：
${possibleFfmpegPaths.join("\n")}
也已递归遍历 ./ffmpeg 目录，但未找到。
请检查：
1. FFmpeg 压缩包是否完整（重新下载）；
2. 压缩包内是否包含 ffmpeg.exe（手动解压验证）。
	      `);
	    }

	    // 第七步：复制 ffmpeg.exe 到目标位置
	    console.log(`✅ 最终找到 FFmpeg：${ffmpegBinPath}`);
	    await fs.copyFile(ffmpegBinPath, config.windows.ffmpegRealname);
	    console.log(`✅ FFmpeg 复制成功：${ffmpegBinPath} -> ${config.windows.ffmpegRealname}`);

	    // 第八步：清理临时文件
	    await fs.rm("./ffmpeg", { recursive: true, force: true });
	    await fs.rm(`${config.windows.ffmpegName}.7z`, { force: true });
	    console.log('✅ 临时文件清理完成');
	  } catch (e) {
	    console.error("❌ FFmpeg 解压/复制失败:", e.message);
	    // 打印错误堆栈（便于调试）
	    console.error(e.stack);
	    process.exit(1);
	  }
	} else {
		console.log('ℹ️ FFmpeg 已存在，跳过下载/解压');
	}
}

async function getMostRecentBinaryPath(targetArch, paths) {
	const validPaths = await Promise.all(paths.map(async (path) => {
		if (await fs.exists(path)) {
			const { stdout } = await $`file ${path}`.quiet();
			const binaryArch = stdout.includes('arm64') ? 'arm64' :
				stdout.includes('x86_64') ? 'x86_64' : null;
			if (binaryArch === targetArch) {
				const stat = await fs.stat(path);
				return { path, mtime: stat.mtime };
			}
		}
		return null;
	}));

	const filteredPaths = validPaths.filter(Boolean);

	if (filteredPaths.length === 0) {
		return null;
	}

	return filteredPaths.reduce((mostRecent, current) =>
		current.mtime > mostRecent.mtime ? current : mostRecent
	).path;
}

/* ########## macOS ########## */
if (platform == 'macos') {
	const architectures = ['arm64', 'x86_64'];
	for (const arch of architectures) {
		if (process.env['SKIP_SCREENPIPE_SETUP']) {
			break;
		}
		console.log(`Setting up screenpipe bin for ${arch}...`);
		if (arch === 'arm64') {
			const paths = [
				"../../target/aarch64-apple-darwin/release/screenpipe",
				"../../target/release/screenpipe"
			];
			const mostRecentPath = await getMostRecentBinaryPath('arm64', paths);
			if (mostRecentPath) {
				await $`cp ${mostRecentPath} screenpipe-aarch64-apple-darwin`;
				console.log(`Copied most recent arm64 screenpipe binary from ${mostRecentPath}`);
			} else {
				console.error("No suitable arm64 screenpipe binary found");
			}
		} else if (arch === 'x86_64') {
			// copy screenpipe binary (more recent one)
			const paths = [
				"../../target/x86_64-apple-darwin/release/screenpipe",
				"../../target/release/screenpipe"
			];
			const mostRecentPath = await getMostRecentBinaryPath('x86_64', paths);
			if (mostRecentPath) {
				await $`cp ${mostRecentPath} screenpipe-x86_64-apple-darwin`;
				console.log(`Copied most recent x86_64 screenpipe binary from ${mostRecentPath}`);
			} else {
				console.error("No suitable x86_64 screenpipe binary found");
			}
		}
		console.log(`screenpipe for ${arch} set up successfully.`);
	}

  // Setup ffmpeg and ffprobe for both arm64 and x86_64
  if (!(await fs.exists(`ffmpeg-aarch64-apple-darwin`))) {
    await $`wget --no-config ${config.macos.ffmpegUrlArm} -O ffmpeg-aarch64.zip`;
    await $`unzip -o ffmpeg-aarch64.zip -d ffmpeg-aarch64`;
    await $`cp ffmpeg-aarch64/ffmpeg ffmpeg-aarch64-apple-darwin`;
    await $`rm ffmpeg-aarch64.zip`;
    await $`rm -rf ffmpeg-aarch64`;
  }

  if (!(await fs.exists(`ffprobe-aarch64-apple-darwin`))) {
    await $`wget --no-config ${config.macos.ffprobeUrlArm} -O ffprobe-aarch64.zip`;
    await $`unzip -o ffprobe-aarch64.zip -d ffprobe-aarch64`;
    await $`cp ffprobe-aarch64/ffprobe ffprobe-aarch64-apple-darwin`;
    await $`rm ffprobe-aarch64.zip`;
    await $`rm -rf ffprobe-aarch64`;
  }

  if (!(await fs.exists(`ffmpeg-x86_64-apple-darwin`))) {
    await $`wget --no-config ${config.macos.ffmpegUrlx86_64} -O ffmpeg-x86_64.zip`;
    await $`unzip -o ffmpeg-x86_64.zip -d ffmpeg-x86_64`;
    await $`cp ffmpeg-x86_64/ffmpeg ffmpeg-x86_64-apple-darwin`;
    await $`rm ffmpeg-x86_64.zip`;
    await $`rm -rf ffmpeg-x86_64`;
  }

  if (!(await fs.exists(`ffprobe-x86_64-apple-darwin`))) {
    await $`wget --no-config ${config.macos.ffprobeUrlx86_64} -O ffprobe-x86_64.zip`;
    await $`unzip -o ffprobe-x86_64.zip -d ffprobe-x86_64`;
    await $`cp ffprobe-x86_64/ffprobe ffprobe-x86_64-apple-darwin`;
    await $`rm ffprobe-x86_64.zip`;
    await $`rm -rf ffprobe-x86_64`;
  }

  console.log('FFMPEG and FFPROBE checks completed');
	console.log('Moved and renamed ffmpeg binary for externalBin');

	// Setup Swift UI monitoring
	console.log('Setting up Swift UI monitoring...');
	try {
		const swiftSrc = path.join(cwd, '../../screenpipe-vision/src/ui_monitoring_macos.swift');
		const architectures = ['arm64', 'x86_64'];

		for (const arch of architectures) {
			console.log(`Compiling Swift UI monitor for ${arch}...`);

			const binaryName = `ui_monitor-${arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`;
			const outputPath = path.join(cwd, binaryName);

			// Compile directly to the final destination
			await $`swiftc -O -whole-module-optimization -enforce-exclusivity=unchecked -num-threads 8 -target ${arch}-apple-macos11.0 -o ${outputPath} ${swiftSrc} -framework Cocoa -framework ApplicationServices -framework Foundation`;

			console.log(`Swift UI monitor for ${arch} compiled successfully`);
			await fs.chmod(outputPath, 0o755);
		}
	} catch (error) {
		console.error('Error setting up Swift UI monitoring:', error);
		console.log('Current working directory:', cwd);
		console.log('Expected Swift source path:', path.join(cwd, '../../screenpipe-vision/src/ui_monitoring_macos.swift'));
		throw error;
	}
}

// Development hints
if (!process.env.GITHUB_ENV) {
	console.log('\nCommands to build 🔨:')
	// Get relative path to screenpipe-app-tauri folder
	const relativePath = path.relative(originalCWD, path.join(cwd, '..'))
	if (originalCWD != cwd && relativePath != '') {
		console.log(`cd ${relativePath}`)
	}
	console.log('bun install')

	if (!process.env.GITHUB_ENV) {
		console.log('bun tauri build')
	}
}

// Config Github ENV
if (process.env.GITHUB_ENV) {
	console.log('Adding ENV')
	if (platform == 'macos' || platform == 'windows') {
		const ffmpeg = `FFMPEG_DIR=${exports.ffmpeg}\n`
		console.log('Adding ENV', ffmpeg)
		await fs.appendFile(process.env.GITHUB_ENV, ffmpeg)
	}
	if (platform == 'macos') {
		const embed_metal = 'WHISPER_METAL_EMBED_LIBRARY=ON\n'
		await fs.appendFile(process.env.GITHUB_ENV, embed_metal)
	}
	if (platform == 'windows') {
		const openblas = `OPENBLAS_PATH=${exports.openBlas}\n`
		console.log('Adding ENV', openblas)
		await fs.appendFile(process.env.GITHUB_ENV, openblas)
	}
}

// Near the end of the script, call these functions
await copyBunBinary();

// --dev or --build
const action = process.argv?.[2]
if (action?.includes('--build') || action?.includes('--dev')) {
	process.chdir(path.join(cwd, '..'))
	process.env['FFMPEG_DIR'] = exports.ffmpeg
	if (platform === 'windows') {
		process.env['OPENBLAS_PATH'] = exports.openBlas
		process.env['CLBlast_DIR'] = exports.clblast
		process.env['LIBCLANG_PATH'] = exports.libClang
		process.env['PATH'] = `${process.env['PATH']};${exports.cmake}`
	}
	if (platform == 'macos') {
		process.env['WHISPER_METAL_EMBED_LIBRARY'] = 'ON'
	}
	await $`bun install`
	await $`bunx tauri ${action.includes('--dev') ? 'dev' : 'build'}`
}
