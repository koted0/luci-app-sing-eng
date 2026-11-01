include $(TOPDIR)/rules.mk

LUCI_TITLE:=Sing configuration and service management panel
LUCI_DESCRIPTION:=Lightweight sing-box configuration and service management panel
LUCI_DEPENDS:=+luci-base +sing-box +rpcd +jshn +jsonfilter +curl
LUCI_PKGARCH:=all

PKG_LICENSE:=MIT
PKG_NAME:=luci-app-sing
PKG_VERSION:=1.2
PKG_RELEASE:=3

# Allow an environment variable or the SDK to override the version
ifneq ($(LUCI_SING_VERSION),)
  PKG_VERSION:=$(LUCI_SING_VERSION)
endif

define Build/Prepare/luci-app-sing
	chmod 0755 $(PKG_BUILD_DIR)/root/usr/libexec/rpcd/luci.sing-box \
		$(PKG_BUILD_DIR)/root/usr/libexec/sing-box-panel-worker
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
