#!/bin/sh

ARCH=$(arch)

if [ $ARCH = 'x86_64' ]
then
	echo "amd64";
fi

OS=$(rustc -Vv | grep host | cut -f2 -d'-')
if [ $OS = "apple" ]
then
	OS="darwin"
fi
DOUBLE=$OS-$ARCH
TRIPLE=$(rustc -Vv | grep host | cut -f2 -d' ')

if [ -f "bin/kubo-$TRIPLE" ]
then
	exit
fi

KUBO_VERSIONS=$(curl -s https://dist.ipfs.tech/kubo/versions)
KUBO_LATEST=v${KUBO_VERSIONS##*v}

mkdir -p ./bin
cd bin
curl -Os "https://dist.ipfs.tech/kubo/$KUBO_LATEST/kubo_${KUBO_LATEST}_$DOUBLE.tar.gz"
tar -xf kubo_${KUBO_LATEST}_$DOUBLE.tar.gz
mv ./kubo/ipfs ./kubo-$TRIPLE

rm -R kubo
rm kubo_${KUBO_LATEST}_$DOUBLE.tar.gz
