# Private C9 runtime notices

The optional C9 runtime is assembled from the exact Entware armv7sf packages
listed in `VOT_RUNTIME_MANIFEST.tsv`. It is installed only below the VOT private
directory; it does not replace webOS system libraries, Node, or audio tools.

Every binary archive contains this notice and the exact upstream license and
copyright files pinned by `entware-armv7sf-notices.lock` under `licenses/`.
The Node license file also carries notices for libraries bundled into Node.

| Runtime components                            | Bundled notice files                                     |
| --------------------------------------------- | -------------------------------------------------------- |
| Node                                          | `node-LICENSE.txt`                                       |
| glibc (`libc`, `librt`, `libpthread`)         | `glibc-COPYING.txt`, `glibc-COPYING.LIB.txt`             |
| GCC (`libgcc`, `libssp`, `libstdcpp`, atomic) | `gcc-COPYING3.txt`, `gcc-COPYING.RUNTIME.txt`            |
| OpenSSL, zlib                                 | `openssl-LICENSE.txt`, `zlib-LICENSE.txt`                |
| nghttp2, libuv, c-ares                        | their named `COPYING` or `LICENSE` files                 |
| mpg123 and its split libraries                | `mpg123-COPYING.txt`, `mpg123-AUTHORS.txt`               |
| libltdl                                       | `libltdl-README.txt`, canonical GNU GPLv2/LGPLv2.1 texts |
| alsa-lib                                      | `alsa-lib-COPYING.txt`                                   |

The `Feed-License` column is a verbatim record of Entware's package metadata,
not a correction of upstream licensing. In particular, Entware labels its
split `libc`, `librt`, and `libpthread` packages
`GPL-3.0-with-GCC-exception`; the bundled upstream glibc 2.27 `COPYING` and
`COPYING.LIB` files state the applicable GPL/LGPL terms. GCC runtime packages
are accompanied by both GPLv3 and the GCC Runtime Library Exception.

Component source and license origins are immutable commit URLs in the notice
lock. Corresponding source for Entware packages is available through the
Entware/OpenWrt build repositories and each package's upstream URL. Release
publishers must distribute this complete `THIRD_PARTY_NOTICES/` directory with
the private runtime archive and satisfy any corresponding-source obligations.
