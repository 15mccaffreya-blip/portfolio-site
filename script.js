const parallaxLayers = [...document.querySelectorAll('[data-parallax-layer]')];

if (parallaxLayers.length && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
	let parallaxFrame = 0;
	const updateParallax = () => {
		parallaxFrame = 0;
		const projectStack = document.querySelector('.project-stack');
		if (!projectStack) return;
		const stackTop = projectStack.getBoundingClientRect().top + window.scrollY;
		for (const layer of parallaxLayers) {
			const section = layer.closest('.project-case');
			if (!section) continue;
			const sectionIndex = [...projectStack.children].indexOf(section);
			if (sectionIndex > 0) {
				layer.style.transform = 'none';
				continue;
			}
			const progress = Math.max(0, Math.min(1, window.scrollY / Math.max(1, stackTop)));
			layer.style.transform = `translate3d(0, ${(0.5 - progress) * 44}px, 0)`;
		}
	};
	const requestParallaxUpdate = () => {
		if (!parallaxFrame) parallaxFrame = requestAnimationFrame(updateParallax);
	};
	window.addEventListener('scroll', requestParallaxUpdate, { passive: true });
	window.addEventListener('resize', requestParallaxUpdate);
	requestParallaxUpdate();
}

const asciiCanvas = document.querySelector('.ascii-background');
const asciiContext = asciiCanvas?.getContext('2d');

if (asciiCanvas && asciiContext) {
	const cellWidth = 7;
	const cellHeight = 11;
	const characterRamp = ' .:-=+*#%@';
	const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	const gifImage = new Image();
	const sampleCanvas = document.createElement('canvas');
	const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true });
	const keyBackgroundToBlack = document.body.dataset.asciiKeyBackground === 'black';
	let canvasWidth = 0;
	let canvasHeight = 0;
	let animationFrame = 0;
	let frameTimer = 0;
	let activeObjectUrl = '';
	let gifDecoder = null;
	let gifFrameCount = 0;
	let gifFrameIndex = 0;
	let loadSequence = 0;
	let decodingFrame = false;
	let redrawAfterDecode = false;

	const getArtBounds = () => {
		const sidebarWidth = document.querySelector('.site-sidebar')?.getBoundingClientRect().width ?? 0;
		const homeBounds = document.querySelector('.home-section')?.getBoundingClientRect();
		const isPhone = window.matchMedia('(max-width: 560px)').matches;
		if (keyBackgroundToBlack && isPhone) {
			const availableWidth = Math.max(0, canvasWidth - sidebarWidth - 24);
			const width = 480;
			const height = 360;
			return {
				left: sidebarWidth + 12 + (availableWidth - width) / 2,
				top: canvasHeight - height + 12,
				width,
				height,
				alignBottom: true
			};
		}
		if (homeBounds) {
			const projectsHero = document.querySelector('.projects-hero');
			if (projectsHero) {
				const availableWidth = Math.max(0, canvasWidth - sidebarWidth - 24);
				const width = availableWidth * (isPhone ? 6.3 : 0.8);
				const top = canvasHeight * (isPhone ? 0.35 : 0.1);
				return {
					left: isPhone ? sidebarWidth + 12 : sidebarWidth + 12 + availableWidth * 0.43,
					faceCenterX: isPhone ? sidebarWidth + 12 + availableWidth * 0.6 : null,
					top,
					width,
					height: Math.max(0, Math.min(canvasHeight * (isPhone ? 0.98 : 0.82), canvasHeight - top - 12))
				};
			}
			const top = Math.max(0, homeBounds.top + homeBounds.height * (isPhone ? 0.28 : 0.43));
			const availableWidth = Math.max(0, canvasWidth - sidebarWidth - 24);
			const width = availableWidth * (isPhone ? 6.3 : 1);
			return {
				left: sidebarWidth + 12 - (width - availableWidth) / 2,
				faceCenterX: isPhone ? sidebarWidth + 12 + availableWidth * 0.62 : null,
				top,
				width,
				height: isPhone
					? canvasHeight * 0.98
					: Math.max(0, Math.min(homeBounds.height * 0.66, canvasHeight - top - 12))
			};
		}
		return {
			left: sidebarWidth + 12 + (keyBackgroundToBlack ? Math.max(0, canvasWidth - sidebarWidth - 24) * 0.16 : 0),
			top: keyBackgroundToBlack ? 38 : 12,
			width: Math.max(0, canvasWidth - sidebarWidth - 24),
			height: Math.max(0, canvasHeight - 24),
			alignBottom: keyBackgroundToBlack
		};
	};

	const drawAsciiFrame = (sourceFrame) => {
		asciiContext.clearRect(0, 0, canvasWidth, canvasHeight);
		if (!sourceFrame || !sampleContext) return;

		const bounds = getArtBounds();
		const sourceWidth = sourceFrame.displayWidth ?? sourceFrame.naturalWidth;
		const sourceHeight = sourceFrame.displayHeight ?? sourceFrame.naturalHeight;
		if (!sourceWidth || !sourceHeight) return;
		const sourceAspect = sourceWidth / sourceHeight;
		const drawWidth = Math.min(bounds.width, bounds.height * sourceAspect);
		const drawHeight = drawWidth / sourceAspect;
		const columns = Math.max(1, Math.floor(drawWidth / cellWidth));
		const rows = Math.max(1, Math.floor(drawHeight / cellHeight));
		const left = bounds.faceCenterX === null || bounds.faceCenterX === undefined
			? bounds.left + (bounds.width - drawWidth) * 0.72
			: bounds.faceCenterX - drawWidth * 0.48;
		const top = bounds.alignTop
			? bounds.top
			: bounds.alignBottom
			? bounds.top + bounds.height - drawHeight
			: bounds.top + (bounds.height - drawHeight) / 2;

		sampleCanvas.width = columns;
		sampleCanvas.height = rows;
		sampleContext.save();
		sampleContext.translate(columns, 0);
		sampleContext.scale(-1, 1);
		sampleContext.drawImage(sourceFrame, 0, 0, columns, rows);
		sampleContext.restore();

		const pixels = sampleContext.getImageData(0, 0, columns, rows).data;
		const backgroundRed = pixels[0];
		const backgroundGreen = pixels[1];
		const backgroundBlue = pixels[2];
		asciiContext.font = '9px "JetBrains Mono", Consolas, monospace';
		asciiContext.textBaseline = 'top';

		for (let row = 0; row < rows; row += 1) {
			for (let column = 0; column < columns; column += 1) {
				const pixelIndex = (row * columns + column) * 4;
				let alpha = pixels[pixelIndex + 3] / 255;
				if (alpha === 0) continue;

			let red = pixels[pixelIndex];
			let green = pixels[pixelIndex + 1];
			let blue = pixels[pixelIndex + 2];
				const backgroundDistance = Math.hypot(red - backgroundRed, green - backgroundGreen, blue - backgroundBlue);
				if (keyBackgroundToBlack && backgroundDistance < 48) continue;
				const isRocketRed = keyBackgroundToBlack && red > green * 1.2 && red > blue * 1.2;
				if (isRocketRed) {
					const average = (red + green + blue) / 3;
					red = Math.min(255, average + (red - average) * 1.32);
					green = Math.max(0, average + (green - average) * 1.32);
					blue = Math.max(0, average + (blue - average) * 1.32);
					alpha = Math.max(alpha, 0.92);
				}
				const brightness = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
				const characterBrightness = isRocketRed ? Math.min(1, brightness * 1.7) : brightness;
				const characterIndex = Math.round(characterBrightness * (characterRamp.length - 1));
				const character = characterRamp[characterIndex];
				if (character === ' ') continue;

				asciiContext.fillStyle = `rgba(${red}, ${green}, ${blue}, ${alpha})`;
				asciiContext.fillText(character, left + column * cellWidth, top + row * cellHeight);
			}
		}
	};

	const decodeNextFrame = async (sequence) => {
		if (!gifDecoder || sequence !== loadSequence || document.hidden) return;
		if (decodingFrame) {
			redrawAfterDecode = true;
			return;
		}
		decodingFrame = true;
		let delay = 100;
		try {
			const decoder = gifDecoder;
			const decoded = await decoder.decode({ frameIndex: gifFrameIndex });
			const frame = decoded.image;
			if (sequence !== loadSequence) {
				frame.close();
			} else {
				gifFrameIndex = (gifFrameIndex + 1) % gifFrameCount;
				delay = Math.max(20, (frame.duration ?? 100000) / 1000);
				drawAsciiFrame(frame);
				frame.close();
			}
		} catch {
			if (sequence === loadSequence) console.error('Could not decode configured GIF.');
		} finally {
			decodingFrame = false;
			if (sequence !== loadSequence) {
				redrawAfterDecode = false;
				if (gifDecoder && !document.hidden) decodeNextFrame(loadSequence);
				return;
			}
			if (document.hidden || reduceMotion || gifFrameCount <= 1) return;
			if (redrawAfterDecode) {
				redrawAfterDecode = false;
				decodeNextFrame(sequence);
				return;
			}
			frameTimer = window.setTimeout(() => decodeNextFrame(sequence), delay);
		}
	};

	const drawImageFallback = () => {
		drawAsciiFrame(gifImage);
		if (!reduceMotion && !document.hidden) animationFrame = requestAnimationFrame(drawImageFallback);
	};

	const startImageFallback = (file, sequence) => {
		if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl);
		activeObjectUrl = URL.createObjectURL(file);
		gifImage.onload = () => {
			if (sequence !== loadSequence) return;
			cancelAnimationFrame(animationFrame);
			drawImageFallback();
		};
		gifImage.onerror = () => {
			if (sequence === loadSequence) console.error('Could not read configured GIF:', file.name);
			asciiContext.clearRect(0, 0, canvasWidth, canvasHeight);
		};
		gifImage.src = activeObjectUrl;
	};

	const startGif = async (path, fallbackPath = '') => {
		const sequence = ++loadSequence;
		cancelAnimationFrame(animationFrame);
		window.clearTimeout(frameTimer);
		gifDecoder?.close();
		gifDecoder = null;
		gifFrameIndex = 0;
		try {
			const response = await fetch(path);
			if (!response.ok) throw new Error(`GIF request failed: ${response.status}`);
			const file = await response.blob();
			if (typeof ImageDecoder === 'function' && await ImageDecoder.isTypeSupported('image/gif')) {
				try {
					const decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: 'image/gif' });
				await decoder.tracks.ready;
				if (sequence !== loadSequence) {
					decoder.close();
					return;
				}
				gifDecoder = decoder;
				gifFrameCount = decoder.tracks.selectedTrack.frameCount;
				await decodeNextFrame(sequence);
				return;
				} catch {
				if (sequence !== loadSequence) return;
				}
			}
			if (sequence === loadSequence) startImageFallback(file, sequence);
		} catch (error) {
			if (sequence !== loadSequence) return;
			if (fallbackPath && fallbackPath !== path) {
				startGif(fallbackPath);
				return;
			}
			console.error('Could not load configured GIF:', path, error);
		}
	};

	let activeGifPath = '';
	const loadGifForViewport = () => {
		const desktopPath = document.body.dataset.asciiGif;
		const isPhone = window.matchMedia('(max-width: 560px)').matches;
		const mobilePath = document.body.dataset.asciiGifMobile;
		const path = isPhone && mobilePath ? mobilePath : desktopPath;
		if (!path || path === activeGifPath) return;
		activeGifPath = path;
		startGif(path, isPhone && path !== desktopPath ? desktopPath : '');
	};

	const resizeCanvas = () => {
		cancelAnimationFrame(animationFrame);
		window.clearTimeout(frameTimer);
		const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
		canvasWidth = window.innerWidth;
		canvasHeight = window.innerHeight;
		asciiCanvas.width = Math.round(canvasWidth * pixelRatio);
		asciiCanvas.height = Math.round(canvasHeight * pixelRatio);
		asciiContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
		if (gifDecoder) decodeNextFrame(loadSequence);
		else if (gifImage.complete && gifImage.naturalWidth) drawImageFallback();
	};

	window.addEventListener('resize', () => {
		resizeCanvas();
		loadGifForViewport();
	});
	document.addEventListener('visibilitychange', () => {
		if (document.hidden) {
			cancelAnimationFrame(animationFrame);
			window.clearTimeout(frameTimer);
		}
		else if (gifDecoder) decodeNextFrame(loadSequence);
		else if (gifImage.naturalWidth) drawImageFallback();
	});
	resizeCanvas();
	loadGifForViewport();
}

const submenuToggles = [...document.querySelectorAll('.submenu-toggle')];
if (submenuToggles.length) {
	const closeSubmenu = (toggle) => {
		const submenu = document.getElementById(toggle.getAttribute('aria-controls'));
		if (!submenu) return;
		toggle.setAttribute('aria-expanded', 'false');
		toggle.setAttribute('aria-label', `Show ${toggle.dataset.menuName}`);
		submenu.hidden = true;
	};

	for (const toggle of submenuToggles) {
		const disclosure = toggle.closest('.nav-disclosure');
		const submenu = document.getElementById(toggle.getAttribute('aria-controls'));
		const activeLink = disclosure?.querySelector('.nav-link[aria-current="page"]');
		if (!submenu) continue;

		if (activeLink) {
			toggle.setAttribute('aria-expanded', 'true');
			toggle.setAttribute('aria-label', `Hide ${toggle.dataset.menuName}`);
			submenu.hidden = false;
		}

		toggle.addEventListener('click', () => {
			const isOpen = toggle.getAttribute('aria-expanded') === 'true';
			toggle.setAttribute('aria-expanded', String(!isOpen));
			toggle.setAttribute('aria-label', `${isOpen ? 'Show' : 'Hide'} ${toggle.dataset.menuName}`);
			submenu.hidden = isOpen;
		});
	}

	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') submenuToggles.forEach(closeSubmenu);
	});
}

document.querySelector('#year').textContent = new Date().getFullYear();
