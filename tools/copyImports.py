import json, shutil, os

paths = [
	"node_modules/%s/dist/index.min.js",
	"node_modules/%s/dist/%s.min.js",
	"node_modules/%s/lib/index.js",
	"node_modules/%s/index.js",
]

package = json.load(open("package.json"))
for i in package["dependencies"]:
	for path in paths:
		if path.count('%s') == 1:
			if os.path.isfile(path % i):
				shutil.copyfile(path % i, "ui/libs/%s.%s" % (i.replace('/', '-').replace('@', ''), '.'.join(path.split('.')[1:])))
				break
		else:
			if os.path.isfile(path % (i, i)):
				shutil.copyfile(path % (i, i), "ui/libs/%s.%s" % (i.replace('/', '-').replace('@', ''), '.'.join(path.split('.')[1:])))
				break