// Slideshow generation script for Adobe After Effects
(function () {
    app.beginUndoGroup("Generate Slideshow");

    function ensureProject() {
        if (!app.project) {
            app.newProject();
        }
    }

    function collectImageFiles(folderPath) {
        var folder = new Folder(folderPath);
        if (!folder.exists) {
            throw new Error("Folder not found: " + folderPath);
        }
        var files = folder.getFiles(function (file) {
            if (!(file instanceof File)) {
                return false;
            }
            return (/\.(png|jpe?g|tiff?|bmp)$/i).test(file.name);
        });
        if (!files || files.length === 0) {
            throw new Error("No image files found in folder: " + folderPath);
        }
        return files;
    }

    function importFiles(files) {
        var imported = [];
        for (var i = 0; i < files.length; i += 1) {
            var file = files[i];
            var importOptions = new ImportOptions(file);
            if (importOptions.canImportAs(ImportAsType.FOOTAGE)) {
                importOptions.importAs = ImportAsType.FOOTAGE;
            }
            var footage = app.project.importFile(importOptions);
            imported.push({
                item: footage
            });
        }
        return imported;
    }

    function createComp(name, width, height, pixelAspect, duration, frameRate) {
        return app.project.items.addComp(name, width, height, pixelAspect, duration, frameRate);
    }

    ensureProject();

    var sourceFolders = [
        "D:/folder1/1",
        "D:/folder1/2",
        "D:/folder1/3"
    ];

    var allFiles = [];
    for (var sf = 0; sf < sourceFolders.length; sf += 1) {
        var currentFiles = collectImageFiles(sourceFolders[sf]);
        if (currentFiles && currentFiles.length > 0) {
            currentFiles.sort(function (a, b) {
                var aName = a.name ? a.name.toLowerCase() : "";
                var bName = b.name ? b.name.toLowerCase() : "";
                if (aName < bName) {
                    return -1;
                }
                if (aName > bName) {
                    return 1;
                }
                return 0;
            });
            for (var cf = 0; cf < currentFiles.length; cf += 1) {
                allFiles.push(currentFiles[cf]);
            }
        }
    }

    if (allFiles.length === 0) {
        throw new Error("No image files found in any configured folders.");
    }

    var footageEntries = importFiles(allFiles);

    var compWidth = 1920;
    var compHeight = 1080;
    var frameRate = 30;

    function framesToTime(frames) {
        return frames / frameRate;
    }

    var fadeFrames = 15;
    var gapBetweenPhotosFrames = 30;
    var holdFramesTwoUp = 135;
    var holdFramesSingle = 135;

    var fadeDuration = framesToTime(fadeFrames);
    var gapBetweenPhotos = framesToTime(gapBetweenPhotosFrames);
    var holdDurationTwoUp = framesToTime(holdFramesTwoUp);
    var holdDurationSingle = framesToTime(holdFramesSingle);

    var maxSegmentDuration = 3 * fadeDuration + gapBetweenPhotos + holdDurationTwoUp;
    var estimatedDuration = maxSegmentDuration * footageEntries.length;
    var comp = createComp("Slideshow", compWidth, compHeight, 1, Math.max(estimatedDuration, 30), frameRate);

    var backgroundColors = [
        [0.95, 0.9, 0.85],
        [0.88, 0.88, 0.88],
        [0.96, 0.86, 0.9]
    ];

    var timeCursor = 0;

    function calculateFitScale(layer, boxWidth, boxHeight) {
        var footage = layer.source;
        if (!footage || !footage.width || !footage.height) {
            return 100;
        }
        var scaleFactor = Math.min(boxWidth / footage.width, boxHeight / footage.height) * 100;
        return scaleFactor;
    }

    function calculateRelativeScaleToComp(layer, boxWidth, boxHeight) {
        var compFitScale = calculateFitScale(layer, compWidth, compHeight);
        if (!compFitScale || compFitScale <= 0) {
            return { compScale: 100, relativePercent: 100 };
        }
        var targetScale = calculateFitScale(layer, boxWidth, boxHeight);
        var relativePercent = (targetScale / compFitScale) * 100;
        if (!isFinite(relativePercent) || relativePercent <= 0) {
            relativePercent = 100;
        }
        return { compScale: compFitScale, relativePercent: relativePercent };
    }

    var singleLayoutRatioThreshold = 1.77;

    function calculateSingleLayoutScale(layer, ratio) {
        if (!isFinite(ratio) || ratio <= 0) {
            ratio = 1;
        }
        var targetWidth;
        var targetHeight;
        if (ratio > singleLayoutRatioThreshold) {
            targetWidth = compWidth;
            targetHeight = compHeight * 2;
        } else {
            targetWidth = compWidth * 2;
            targetHeight = compHeight;
        }
        return calculateRelativeScaleToComp(layer, targetWidth, targetHeight);
    }

    function applyFadeAndZoom(layer, fadeInStart, fadeOutStart, fadeDurationLocal, compScale, relativePercent) {
        var baseScale = compScale * (relativePercent / 100);
        var zoomTargetScale = baseScale * 1.1;
        if (zoomTargetScale < baseScale) {
            zoomTargetScale = baseScale;
        }
        var scaleProp = layer.property("Scale");
        scaleProp.setValueAtTime(fadeInStart, [baseScale, baseScale]);
        scaleProp.setValueAtTime(fadeInStart + fadeDurationLocal, [baseScale, baseScale]);
        scaleProp.setValueAtTime(fadeOutStart, [zoomTargetScale, zoomTargetScale]);
        scaleProp.setValueAtTime(fadeOutStart + fadeDurationLocal, [zoomTargetScale, zoomTargetScale]);

        var opacityProp = layer.property("Opacity");
        opacityProp.setValueAtTime(fadeInStart, 0);
        opacityProp.setValueAtTime(fadeInStart + fadeDurationLocal, 100);
        opacityProp.setValueAtTime(fadeOutStart, 100);
        opacityProp.setValueAtTime(fadeOutStart + fadeDurationLocal, 0);
    }

    var backgroundLayer = comp.layers.addSolid(backgroundColors[0], "Background", compWidth, compHeight, 1, comp.duration);
    backgroundLayer.moveToEnd();
    var backgroundEffects = backgroundLayer.property("Effects");
    if (!backgroundEffects) {
        backgroundEffects = backgroundLayer.property("ADBE Effect Parade");
    }
    var backgroundEffect = backgroundEffects.addProperty("ADBE Fill");
    var backgroundColorProperty = backgroundEffect.property("Color");
    backgroundColorProperty.setValue([backgroundColors[0][0], backgroundColors[0][1], backgroundColors[0][2], 1]);
    var backgroundKeyframes = [];

    var horizontalMargin = 20;
    var verticalMargin = 40;

    var portraitBuffer = null;
    var segments = [];

    for (var idx = 0; idx < footageEntries.length; idx += 1) {
        var footageItem = footageEntries[idx].item;
        var width = footageItem && footageItem.width ? footageItem.width : compWidth;
        var height = footageItem && footageItem.height ? footageItem.height : compHeight;
        var ratio = height === 0 ? 1 : width / height;

        if (ratio > 1 || Math.abs(ratio - 1) < 0.0001) {
            segments.push({
                type: "single",
                items: [footageItem]
            });
        } else {
            if (portraitBuffer === null) {
                portraitBuffer = footageItem;
            } else {
                segments.push({
                    type: "twoUp",
                    items: [portraitBuffer, footageItem]
                });
                portraitBuffer = null;
            }
        }
    }

    if (portraitBuffer !== null) {
        segments.push({
            type: "single",
            items: [portraitBuffer]
        });
        portraitBuffer = null;
    }

    var segmentDurations = [];
    for (var sd = 0; sd < segments.length; sd += 1) {
        if (segments[sd].type === "twoUp") {
            segmentDurations.push(3 * fadeDuration + gapBetweenPhotos + holdDurationTwoUp);
        } else {
            segmentDurations.push(2 * fadeDuration + holdDurationSingle);
        }
    }

    var totalDuration = 0;
    for (var td = 0; td < segmentDurations.length; td += 1) {
        totalDuration += segmentDurations[td];
    }

    comp.duration = Math.max(totalDuration, 30);
    backgroundLayer.outPoint = comp.duration;

    for (var sg = 0; sg < segments.length; sg += 1) {
        var segment = segments[sg];
        var segmentDuration = segmentDurations[sg];
        var bgColor = backgroundColors[Math.floor(Math.random() * backgroundColors.length)];
        backgroundKeyframes.push({ time: timeCursor, color: bgColor });

        if (segment.type === "twoUp") {
            var leftLayer = comp.layers.add(segment.items[0]);
            leftLayer.startTime = timeCursor;
            leftLayer.inPoint = timeCursor;
            leftLayer.outPoint = timeCursor + segmentDuration;
            leftLayer.property("Position").setValue([compWidth * 0.25, compHeight * 0.5]);
            var leftScaleInfo = calculateRelativeScaleToComp(leftLayer, compWidth * 0.5 - horizontalMargin, compHeight - 2 * verticalMargin);

            var rightLayer = comp.layers.add(segment.items[1]);
            rightLayer.startTime = timeCursor;
            rightLayer.inPoint = timeCursor;
            rightLayer.outPoint = timeCursor + segmentDuration;
            rightLayer.property("Position").setValue([compWidth * 0.75, compHeight * 0.5]);
            var rightScaleInfo = calculateRelativeScaleToComp(rightLayer, compWidth * 0.5 - horizontalMargin, compHeight - 2 * verticalMargin);

            var leftFadeInStart = timeCursor;
            var rightFadeInStart = timeCursor + fadeDuration + gapBetweenPhotos;
            var fadeOutStart = timeCursor + segmentDuration - fadeDuration;

            applyFadeAndZoom(leftLayer, leftFadeInStart, fadeOutStart, fadeDuration, leftScaleInfo.compScale, leftScaleInfo.relativePercent);
            applyFadeAndZoom(rightLayer, rightFadeInStart, fadeOutStart, fadeDuration, rightScaleInfo.compScale, rightScaleInfo.relativePercent);
        } else {
            var singleItem = segment.items[0];
            var singleLayer = comp.layers.add(singleItem);
            singleLayer.startTime = timeCursor;
            singleLayer.inPoint = timeCursor;
            singleLayer.outPoint = timeCursor + segmentDuration;
            singleLayer.property("Position").setValue([compWidth * 0.5, compHeight * 0.5]);
            var singleSourceWidth = singleItem && singleItem.width ? singleItem.width : compWidth;
            var singleSourceHeight = singleItem && singleItem.height ? singleItem.height : compHeight;
            var singleRatio = singleSourceHeight === 0 ? 1 : singleSourceWidth / singleSourceHeight;
            var singleScaleInfo = calculateSingleLayoutScale(singleLayer, singleRatio);

            var singleFadeInStart = timeCursor;
            var singleFadeOutStart = timeCursor + segmentDuration - fadeDuration;

            applyFadeAndZoom(singleLayer, singleFadeInStart, singleFadeOutStart, fadeDuration, singleScaleInfo.compScale, singleScaleInfo.relativePercent);
        }

        timeCursor += segmentDuration;
    }

    if (timeCursor < comp.duration) {
        comp.duration = timeCursor;
        backgroundLayer.outPoint = timeCursor;
    }

    if (backgroundKeyframes.length > 0) {
        for (var k = 0; k < backgroundKeyframes.length; k += 1) {
            var keyframe = backgroundKeyframes[k];
            var color = keyframe.color;
            backgroundColorProperty.setValueAtTime(keyframe.time, [color[0], color[1], color[2], 1]);
        }
        var lastColor = backgroundKeyframes[backgroundKeyframes.length - 1].color;
        backgroundColorProperty.setValueAtTime(timeCursor, [lastColor[0], lastColor[1], lastColor[2], 1]);
    }

    app.project.renderQueue.items.add(comp);

    app.endUndoGroup();
})();
