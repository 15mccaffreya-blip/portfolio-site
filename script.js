const decodeGifLzw = (minCodeSize, data, pixelCount) => {
	const clearCode = 1 << minCodeSize;
	const endCode = clearCode + 1;
	const prefix = new Uint16Array(4096);
	const suffix = new Uint8Array(4096);
	const stack = new Uint8Array(4097);
	const output = new Uint8Array(pixelCount);
	for (let index = 0; index < clearCode; index += 1) suffix[index] = index;
	let codeSize = minCodeSize + 1;
	let nextCode = endCode + 1;
	let previousCode = -1;
	let firstByte = 0;
	let bitBuffer = 0;
	let bitCount = 0;
	let dataPosition = 0;
	let outputPosition = 0;
	while (outputPosition < pixelCount) {
		while (bitCount < codeSize) {
			if (dataPosition >= data.length) return output;
			bitBuffer |= data[dataPosition++] << bitCount;
			bitCount += 8;
		}
		let code = bitBuffer & ((1 << codeSize) - 1);
		bitBuffer >>= codeSize;
		bitCount -= codeSize;
		if (code === clearCode) {
			codeSize = minCodeSize + 1;
			nextCode = endCode + 1;
			previousCode = -1;
			continue;
		}
		if (code === endCode) break;
		if (previousCode === -1) {
			output[outputPosition++] = suffix[code];
			previousCode = code;
			firstByte = code;
			continue;
		}
		const incomingCode = code;
		let stackSize = 0;
		if (code >= nextCode) {
			stack[stackSize++] = firstByte;
			code = previousCode;
		}
		while (code >= clearCode) {
			stack[stackSize++] = suffix[code];
			code = prefix[code];
		}
		firstByte = suffix[code];
		stack[stackSize++] = firstByte;
		if (nextCode < 4096) {
			prefix[nextCode] = previousCode;
			suffix[nextCode] = firstByte;
			nextCode += 1;
			if (nextCode === (1 << codeSize) && codeSize < 12) codeSize += 1;
		}
		previousCode = incomingCode;
		while (stackSize > 0 && outputPosition < pixelCount) output[outputPosition++] = stack[--stackSize];
	}
	return output;
};

// iOS Safari has no ImageDecoder and won't animate GIFs drawn to a canvas, so frames are decoded here.
const decodeGifFrames = async (buffer, { maxWidth = 320, isCancelled = () => false, onFirstFrame = null } = {}) => {
	const bytes = new Uint8Array(buffer);
	if (bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) throw new Error('Not a GIF file.');
	const width = bytes[6] | (bytes[7] << 8);
	const height = bytes[8] | (bytes[9] << 8);
	const screenFlags = bytes[10];
	let position = 13;
	let globalPalette = null;
	if (screenFlags & 0x80) {
		const paletteSize = 3 << ((screenFlags & 7) + 1);
		globalPalette = bytes.subarray(position, position + paletteSize);
		position += paletteSize;
	}

	const scale = Math.min(1, maxWidth / width);
	const outputWidth = Math.max(1, Math.round(width * scale));
	const outputHeight = Math.max(1, Math.round(height * scale));
	const fullCanvas = document.createElement('canvas');
	fullCanvas.width = width;
	fullCanvas.height = height;
	const fullContext = fullCanvas.getContext('2d');
	const fullImage = fullContext.createImageData(width, height);
	const full = fullImage.data;
	const frames = [];
	let control = { delay: 100, disposal: 0, transparent: -1 };
	let lastYield = performance.now();

	while (position < bytes.length) {
		const marker = bytes[position++];
		if (marker === 0x3b) break;
		if (marker === 0x21) {
			const label = bytes[position++];
			if (label === 0xf9) {
				const packed = bytes[position + 1];
				control = {
					disposal: (packed >> 2) & 7,
					transparent: packed & 1 ? bytes[position + 4] : -1,
					delay: (bytes[position + 2] | (bytes[position + 3] << 8)) * 10
				};
			}
			let extensionSize;
			while (position < bytes.length && (extensionSize = bytes[position++]) !== 0) position += extensionSize;
			continue;
		}
		if (marker !== 0x2c) continue;

		const left = bytes[position] | (bytes[position + 1] << 8);
		const top = bytes[position + 2] | (bytes[position + 3] << 8);
		const frameWidth = bytes[position + 4] | (bytes[position + 5] << 8);
		const frameHeight = bytes[position + 6] | (bytes[position + 7] << 8);
		const frameFlags = bytes[position + 8];
		position += 9;
		let palette = globalPalette;
		if (frameFlags & 0x80) {
			const paletteSize = 3 << ((frameFlags & 7) + 1);
			palette = bytes.subarray(position, position + paletteSize);
			position += paletteSize;
		}
		const minCodeSize = bytes[position++];
		const chunks = [];
		let total = 0;
		let chunkSize;
		while (position < bytes.length && (chunkSize = bytes[position++]) !== 0) {
			chunks.push(bytes.subarray(position, position + chunkSize));
			position += chunkSize;
			total += chunkSize;
		}
		const data = new Uint8Array(total);
		let offset = 0;
		for (const chunk of chunks) {
			data.set(chunk, offset);
			offset += chunk.length;
		}
		if (!palette) continue;

		const indices = decodeGifLzw(minCodeSize, data, frameWidth * frameHeight);
		const rowOrder = [];
		if (frameFlags & 0x40) {
			for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) {
				for (let row = start; row < frameHeight; row += step) rowOrder.push(row);
			}
		}
		const before = control.disposal === 3 ? full.slice() : null;
		for (let row = 0; row < frameHeight; row += 1) {
			const targetRow = top + (rowOrder.length ? rowOrder[row] : row);
			if (targetRow >= height) continue;
			for (let column = 0; column < frameWidth; column += 1) {
				const x = left + column;
				if (x >= width) break;
				const index = indices[row * frameWidth + column];
				if (index === control.transparent) continue;
				const paletteOffset = index * 3;
				const pixelOffset = (targetRow * width + x) * 4;
				full[pixelOffset] = palette[paletteOffset];
				full[pixelOffset + 1] = palette[paletteOffset + 1];
				full[pixelOffset + 2] = palette[paletteOffset + 2];
				full[pixelOffset + 3] = 255;
			}
		}

		fullContext.putImageData(fullImage, 0, 0);
		const canvas = document.createElement('canvas');
		canvas.width = outputWidth;
		canvas.height = outputHeight;
		const context = canvas.getContext('2d');
		context.imageSmoothingQuality = 'high';
		context.drawImage(fullCanvas, 0, 0, outputWidth, outputHeight);
		const frame = { canvas, delay: control.delay <= 10 ? 100 : control.delay };
		frames.push(frame);
		if (frames.length === 1) onFirstFrame?.(frame);

		if (control.disposal === 2) {
			for (let row = top; row < Math.min(height, top + frameHeight); row += 1) {
				const start = (row * width + left) * 4;
				full.fill(0, start, (row * width + Math.min(width, left + frameWidth)) * 4);
			}
		} else if (before) {
			full.set(before);
		}
		control = { delay: 100, disposal: 0, transparent: -1 };

		if (performance.now() - lastYield > 12) {
			await new Promise((resolve) => setTimeout(resolve));
			lastYield = performance.now();
			if (isCancelled()) return null;
		}
	}
	return { width, height, frames };
};

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
	const saturationBoost = Math.max(1, Number(document.body.dataset.asciiSaturation) || 1);
	let canvasWidth = 0;
	let canvasHeight = 0;
	let animationFrame = 0;
	let frameTimer = 0;
	let activeObjectUrl = '';
	let gifFrames = null;
	let gifFrameIndex = 0;
	let loadSequence = 0;

	const getArtBounds = () => {
		const sidebarWidth = document.querySelector('.site-sidebar')?.getBoundingClientRect().width ?? 0;
		const homeBounds = document.querySelector('.home-section')?.getBoundingClientRect();
		const isPhone = window.matchMedia('(max-width: 560px)').matches;
		const isRocketEffect = document.body.dataset.asciiEffect === 'rocket';
		if (document.body.dataset.asciiLayout === 'portrait') {
			const availableWidth = Math.max(0, canvasWidth - sidebarWidth - 24);
			const width = availableWidth * (isPhone ? 1.45 : 0.58);
			const bioBounds = document.querySelector('.about-bio')?.getBoundingClientRect();
			const bioBottom = bioBounds ? bioBounds.bottom - (homeBounds?.top ?? 0) : 0;
			const top = isPhone ? Math.max(canvasHeight * 0.4, bioBottom + 24) : canvasHeight * 0.1;
			return {
				left: isPhone ? sidebarWidth + 12 - (width - availableWidth) / 2 : sidebarWidth + 12 + availableWidth * 0.5,
				top,
				width,
				height: Math.max(0, Math.min(canvasHeight * (isPhone ? 0.8 : 0.78), canvasHeight - top - 12)),
				alignBottom: isPhone
			};
		}
		if (isRocketEffect && isPhone) {
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
			left: sidebarWidth + 12 + (isRocketEffect ? Math.max(0, canvasWidth - sidebarWidth - 24) * 0.16 : 0),
			top: isRocketEffect ? 38 : 12,
			width: Math.max(0, canvasWidth - sidebarWidth - 24),
			height: Math.max(0, canvasHeight - 24),
			alignBottom: isRocketEffect
		};
	};

	const drawAsciiFrame = (sourceFrame) => {
		asciiContext.clearRect(0, 0, canvasWidth, canvasHeight);
		if (!sourceFrame || !sampleContext) return;

		const bounds = getArtBounds();
		const sourceWidth = sourceFrame.displayWidth ?? sourceFrame.naturalWidth ?? sourceFrame.width;
		const sourceHeight = sourceFrame.displayHeight ?? sourceFrame.naturalHeight ?? sourceFrame.height;
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
				if (saturationBoost > 1) {
					const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
					red = Math.max(0, Math.min(255, luminance + (red - luminance) * saturationBoost));
					green = Math.max(0, Math.min(255, luminance + (green - luminance) * saturationBoost));
					blue = Math.max(0, Math.min(255, luminance + (blue - luminance) * saturationBoost));
				}
				const isRocketRed = document.body.dataset.asciiEffect === 'rocket' && red > green * 1.2 && red > blue * 1.2;
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

	const playGifFrame = (sequence) => {
		if (!gifFrames || sequence !== loadSequence || document.hidden) return;
		const frame = gifFrames[gifFrameIndex % gifFrames.length];
		gifFrameIndex = (gifFrameIndex + 1) % gifFrames.length;
		drawAsciiFrame(frame.canvas);
		if (reduceMotion || gifFrames.length < 2) return;
		frameTimer = window.setTimeout(() => playGifFrame(sequence), frame.delay);
	};

	const drawImageFallback = () => {
		drawAsciiFrame(gifImage);
		if (!reduceMotion && !document.hidden) animationFrame = requestAnimationFrame(drawImageFallback);
	};

	const startImageFallback = (file, sequence) => {
		if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl);
		activeObjectUrl = URL.createObjectURL(file);
		if (!gifImage.isConnected) {
			// WebKit only animates GIFs that are attached to the document.
			gifImage.alt = '';
			gifImage.setAttribute('aria-hidden', 'true');
			Object.assign(gifImage.style, { position: 'fixed', left: '0', top: '0', width: '1px', height: '1px', opacity: '0.01', pointerEvents: 'none', zIndex: '-1' });
			document.body.append(gifImage);
		}
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
		gifFrames = null;
		gifFrameIndex = 0;
		try {
			const response = await fetch(path);
			if (!response.ok) throw new Error(`GIF request failed: ${response.status}`);
			const file = await response.blob();
			try {
				const decoded = await decodeGifFrames(await file.arrayBuffer(), {
					isCancelled: () => sequence !== loadSequence,
					onFirstFrame: (frame) => {
						if (sequence === loadSequence) drawAsciiFrame(frame.canvas);
					}
				});
				if (!decoded || sequence !== loadSequence) return;
				if (!decoded.frames.length) throw new Error('GIF has no frames.');
				gifFrames = decoded.frames;
				playGifFrame(sequence);
				return;
			} catch {
				if (sequence !== loadSequence) return;
			}
			startImageFallback(file, sequence);
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
		if (gifFrames) playGifFrame(loadSequence);
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
		else if (gifFrames) playGifFrame(loadSequence);
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

const certificationsList = document.querySelector('.certifications-list');
const certificationsToggle = document.querySelector('.certifications-toggle');

if (certificationsList && certificationsToggle) {
	const hasExtraCertifications = certificationsList.children.length > 3;
	certificationsToggle.hidden = !hasExtraCertifications;

	if (hasExtraCertifications) {
		certificationsToggle.addEventListener('click', () => {
			const isExpanded = certificationsList.classList.toggle('is-expanded');
			certificationsToggle.setAttribute('aria-expanded', String(isExpanded));
			certificationsToggle.textContent = isExpanded ? 'Show fewer certifications' : 'Show more certifications';
		});
	}
}

const projectGallery = document.querySelector('.project-gallery');
if (projectGallery) {
	const galleryStage = projectGallery.querySelector('[data-gallery-stage]');
	const galleryCount = projectGallery.querySelector('[data-gallery-count]');
	const galleryThumbnails = projectGallery.querySelector('[data-gallery-thumbnails]');
	const previousPhoto = projectGallery.querySelector('[data-gallery-previous]');
	const nextPhoto = projectGallery.querySelector('[data-gallery-next]');
	let galleryItems = [];
	let galleryIndex = 0;
	let activeGalleryTrigger = null;

	const renderGallery = () => {
		const item = galleryItems[galleryIndex];
		galleryStage.replaceChildren();
		if (item.type === 'image') {
			const image = item.source.cloneNode();
			image.className = 'project-gallery-image';
			image.removeAttribute('data-project-gallery-image');
			galleryStage.append(image);
		} else {
			const placeholder = item.source.cloneNode(true);
			placeholder.classList.add('project-gallery-placeholder');
			placeholder.removeAttribute('data-parallax-layer');
			placeholder.style.transform = 'none';
			galleryStage.append(placeholder);
		}
		galleryCount.textContent = `${galleryIndex + 1} / ${galleryItems.length}`;
		previousPhoto.hidden = galleryItems.length < 2;
		nextPhoto.hidden = galleryItems.length < 2;
		projectGallery.querySelector('.project-gallery-viewer').classList.toggle('is-single-photo', galleryItems.length < 2);
		galleryThumbnails.hidden = galleryItems.length < 2;
		galleryThumbnails.replaceChildren();
		if (galleryItems.length < 2) return;

		galleryItems.forEach((galleryItem, index) => {
			const thumbnail = document.createElement('button');
			thumbnail.type = 'button';
			thumbnail.className = 'project-gallery-thumbnail';
			thumbnail.setAttribute('aria-label', `Show photo ${index + 1}`);
			thumbnail.setAttribute('aria-pressed', String(index === galleryIndex));
			if (galleryItem.type === 'image') {
				const image = galleryItem.source.cloneNode();
				image.removeAttribute('data-project-gallery-image');
				image.alt = '';
				thumbnail.append(image);
			} else {
				thumbnail.append(galleryItem.source.cloneNode(true));
			}
			thumbnail.addEventListener('click', () => {
				galleryIndex = index;
				renderGallery();
			});
			galleryThumbnails.append(thumbnail);
		});
	};

	const moveGallery = (direction) => {
		galleryIndex = (galleryIndex + direction + galleryItems.length) % galleryItems.length;
		renderGallery();
	};

	for (const trigger of document.querySelectorAll('[data-project-gallery-trigger]')) {
		trigger.addEventListener('click', () => {
			const figure = trigger.closest('.case-photo');
			const project = trigger.closest('.project-case');
			const placeholder = figure?.querySelector('.case-photo-surface');
			if (!figure || !project || !placeholder) return;
			activeGalleryTrigger = trigger;
			const projectImages = [...figure.querySelectorAll('.case-photo-gallery-items img')];
			galleryItems = projectImages.length
				? projectImages.map(source => ({ type: 'image', source }))
				: [{ type: 'placeholder', source: placeholder }];
			galleryIndex = 0;
			renderGallery();
			projectGallery.showModal();
		});
	}

	projectGallery.querySelector('.project-gallery-close').addEventListener('click', () => projectGallery.close());
	previousPhoto.addEventListener('click', () => moveGallery(-1));
	nextPhoto.addEventListener('click', () => moveGallery(1));
	projectGallery.addEventListener('click', (event) => {
		if (event.target === projectGallery) projectGallery.close();
	});
	projectGallery.addEventListener('close', () => activeGalleryTrigger?.focus());
	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && projectGallery.open) {
			event.preventDefault();
			projectGallery.close();
		}
	}, true);
	projectGallery.addEventListener('keydown', (event) => {
		if (event.key === 'ArrowLeft' && galleryItems.length > 1) moveGallery(-1);
		if (event.key === 'ArrowRight' && galleryItems.length > 1) moveGallery(1);
	});
}

document.querySelector('#year').textContent = new Date().getFullYear();
