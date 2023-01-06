#!/bin/sh

ARCH=$(rustc -Vv | grep host | cut -f2 -d' ' | cut -f1 -d'-')

if [ $ARCH = 'x86_64' ]
then
	ARCH="amd64";
fi

OS=$(rustc -Vv | grep host | cut -f3 -d'-')
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
if [ ! $OS = 'windows' ]
then
	curl -Os "https://dist.ipfs.tech/kubo/$KUBO_LATEST/kubo_${KUBO_LATEST}_$DOUBLE.tar.gz"
	tar -xf kubo_${KUBO_LATEST}_$DOUBLE.tar.gz
else
	curl -Os "https://dist.ipfs.tech/kubo/$KUBO_LATEST/kubo_${KUBO_LATEST}_$DOUBLE.zip"
	unzip kubo_${KUBO_LATEST}_$DOUBLE.zip
fi
mv ./kubo/ipfs ./kubo-$TRIPLE

rm -R kubo
rm kubo_${KUBO_LATEST}_$DOUBLE.tar.gz
