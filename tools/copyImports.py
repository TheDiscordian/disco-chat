import json, shutil

package = json.load(open("package.json"))
for i in package["dependencies"]:
	try:
		shutil.copyfile("node_modules/%s/dist/index.min.js" % i, "ui/libs/%s.min.js" % i)
	except:
		shutil.copyfile("node_modules/%s/dist/%s.min.js" % (i, i), "ui/libs/%s.min.js" % i)