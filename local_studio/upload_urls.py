"""HTTPS upload-target checks shared by Instagram and the platform publishers."""

from __future__ import annotations

import ipaddress
import socket
from dataclasses import dataclass
from typing import Any, Callable
from urllib.parse import urlparse

from urllib3.connection import HTTPSConnection
from urllib3.connectionpool import HTTPSConnectionPool
from urllib3.exceptions import ConnectTimeoutError, NewConnectionError
from urllib3.poolmanager import PoolManager
from urllib3.util.connection import create_connection

_ALLOWED_UPLOAD_HOST_SUFFIXES = (
    "googleapis.com",
    "googleusercontent.com",
    "instagram.com",
    "facebook.com",
    "fbcdn.net",
    "tiktok.com",
    "tiktokapis.com",
    "tiktokv.com",
    "byteoversea.com",
    "byteoversea.net",
    "ibytedtos.com",
)
_CGNAT = ipaddress.ip_network("100.64.0.0/10")


def _hostname_allowed(hostname: str) -> bool:
    host = hostname.rstrip(".").lower()
    if not host or host == "localhost":
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return any(host == suffix or host.endswith(f".{suffix}") for suffix in _ALLOWED_UPLOAD_HOST_SUFFIXES)


def _ip_blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    candidates: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = [ip]
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        candidates.append(ip.ipv4_mapped)
    for addr in candidates:
        if (
            addr.is_private
            or addr.is_loopback
            or addr.is_link_local
            or addr.is_reserved
            or addr.is_multicast
            or addr.is_unspecified
        ):
            return True
        if isinstance(addr, ipaddress.IPv4Address) and addr in _CGNAT:
            return True
    return False


@dataclass(frozen=True)
class SafeUploadTarget:
    url: str
    hostname: str
    pinned_ip: str


class PinnedHTTPSConnection(HTTPSConnection):
    def __init__(self, *args: Any, pinned_ip: str | None = None, **kwargs: Any) -> None:
        if not pinned_ip:
            raise RuntimeError("Pinned HTTPS connections require a resolved address")
        self._pinned_ip = pinned_ip
        super().__init__(*args, **kwargs)

    def _new_conn(self) -> socket.socket:
        try:
            return create_connection(
                (self._pinned_ip, self.port or 443),
                self.timeout,
                source_address=self.source_address,
                socket_options=self.socket_options,
            )
        except TimeoutError as exc:
            raise ConnectTimeoutError(self, f"Connection to {self.host} timed out.") from exc
        except OSError as exc:
            raise NewConnectionError(self, f"Failed to establish a new connection: {exc}") from exc


class PinnedHTTPSConnectionPool(HTTPSConnectionPool):
    ConnectionCls = PinnedHTTPSConnection


class PinnedPoolManager(PoolManager):
    def __init__(self, pinned_ip: str, hostname: str, *args: Any, **kwargs: Any) -> None:
        self._pinned_ip = pinned_ip
        kwargs.setdefault("assert_hostname", hostname)
        kwargs.setdefault("server_hostname", hostname)
        super().__init__(*args, **kwargs)
        self.pool_classes_by_scheme = {"https": PinnedHTTPSConnectionPool}

    def _new_pool(self, scheme: str, host: str, port: int, request_context: dict[str, Any] | None = None):
        context = dict(request_context or self.connection_pool_kw)
        context["pinned_ip"] = self._pinned_ip
        return super()._new_pool(scheme, host, port, context)


def inspect_https_upload_url(
    url: str,
    *,
    field: str = "upload URL",
    resolver: Callable[..., list[tuple[Any, ...]]] | None = None,
) -> SafeUploadTarget:
    """Reject SSRF-prone upload targets and return the address that must be used."""
    parsed = urlparse(str(url))
    if parsed.scheme != "https" or parsed.username or parsed.password:
        raise RuntimeError(f"{field} must be a https URL without credentials")
    hostname = parsed.hostname or ""
    if not _hostname_allowed(hostname):
        raise RuntimeError(f"{field} host is not allowed")
    lookup = resolver or socket.getaddrinfo
    try:
        infos = lookup(hostname, 443, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise RuntimeError(f"{field} host could not be resolved") from exc
    addresses: list[str] = []
    for info in infos:
        address = info[4][0]
        ip = ipaddress.ip_address(address)
        if _ip_blocked(ip):
            raise RuntimeError(f"{field} resolved to a blocked address")
        if address not in addresses:
            addresses.append(address)
    if not addresses:
        raise RuntimeError(f"{field} host could not be resolved")
    pinned = next((item for item in addresses if ":" not in item), addresses[0])
    return SafeUploadTarget(url=str(url), hostname=hostname, pinned_ip=pinned)


def require_https_upload_url(
    url: str,
    *,
    field: str = "upload URL",
    resolver: Callable[..., list[tuple[Any, ...]]] | None = None,
) -> str:
    return inspect_https_upload_url(url, field=field, resolver=resolver).url


def validated_request(
    requests_module: Any,
    method: str,
    url: str,
    *,
    field: str = "upload URL",
    resolver: Callable[..., list[tuple[Any, ...]]] | None = None,
    **kwargs: Any,
) -> Any:
    """HTTPS request that refuses redirects and connects only to the pre-checked IP."""
    from requests.adapters import HTTPAdapter

    target = inspect_https_upload_url(url, field=field, resolver=resolver)
    kwargs["allow_redirects"] = False
    kwargs.pop("proxies", None)

    class PinnedIPAdapter(HTTPAdapter):
        def init_poolmanager(self, connections: int, maxsize: int, block: bool = False, **pool_kwargs: Any) -> None:
            self.poolmanager = PinnedPoolManager(
                target.pinned_ip,
                target.hostname,
                num_pools=connections,
                maxsize=maxsize,
                block=block,
                **pool_kwargs,
            )

    session = requests_module.Session()
    session.trust_env = False
    session.mount("https://", PinnedIPAdapter())
    try:
        response = session.request(method, target.url, **kwargs)
    finally:
        session.close()
    if 300 <= int(getattr(response, "status_code", 0)) < 400:
        raise RuntimeError(f"{field} refused to follow a redirect")
    return response
